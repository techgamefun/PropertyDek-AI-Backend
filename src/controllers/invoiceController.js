import { randomUUID } from "node:crypto";
import prisma from "../config/prismaClient.js";
import { ApiError } from "../services/apiError.js";
import {
  requireCurrentMembership,
  requireUuid,
} from "../services/organizationAccess.js";
import {
  optionalString,
  requireEnum,
  requireNumber,
  requireObject,
  requireString,
} from "../services/requestValidation.js";

const INVOICE_STATUSES = [
  "DRAFT",
  "OPEN",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "VOID",
];
const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "CHECK", "OTHER"];
const FINANCE_WRITERS = ["OWNER", "ADMIN", "PROPERTY_MANAGER", "ACCOUNTANT"];
const INVOICE_INCLUDE = {
  lease: {
    include: {
      tenant: true,
      unit: { include: { property: true } },
    },
  },
  payments: { orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }] },
};

export async function listInvoices(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const now = new Date();
  await prisma.invoice.updateMany({
    where: {
      organizationId: membership.organizationId,
      status: { in: ["OPEN", "PARTIALLY_PAID"] },
      dueAt: { lt: startOfToday(now) },
    },
    data: { status: "OVERDUE" },
  });

  const where = { organizationId: membership.organizationId };
  if (req.query.status !== undefined) {
    where.status = requireEnum(req.query.status, INVOICE_STATUSES, "status");
  }
  if (req.query.leaseId !== undefined) {
    where.leaseId = requireUuid(req.query.leaseId, "leaseId");
  }
  const invoices = await prisma.invoice.findMany({
    where,
    include: INVOICE_INCLUDE,
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
  });
  return res.json({
    success: true,
    data: { invoices: invoices.map(serializeInvoice) },
  });
}

export async function getInvoiceOptions(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const leases = await prisma.lease.findMany({
    where: {
      organizationId: membership.organizationId,
      status: "ACTIVE",
    },
    include: {
      tenant: true,
      unit: { include: { property: { select: { id: true, name: true } } } },
    },
    orderBy: [{ tenant: { fullName: "asc" } }, { startDate: "desc" }],
  });
  return res.json({ success: true, data: { leases } });
}

export async function getInvoice(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const invoiceId = requireUuid(req.params.invoiceId, "invoiceId");
  await markInvoiceOverdue(invoiceId, membership.organizationId);
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: membership.organizationId },
    include: INVOICE_INCLUDE,
  });
  if (!invoice) {
    throw new ApiError("INVOICE_NOT_FOUND", 404, "Invoice not found.");
  }
  return res.json({
    success: true,
    data: { invoice: serializeInvoice(invoice) },
  });
}

export async function createInvoice(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const body = requireObject(req.body);
  const values = mapInvoiceFields(body, true);
  const leaseId = requireUuid(body.leaseId, "leaseId");
  validateInvoiceValues(values);
  const invoiceNumber = createInvoiceNumber();
  const invoice = await prisma.$transaction(
    async (transaction) => {
      const lease = await transaction.lease.findFirst({
        where: {
          id: leaseId,
          organizationId: membership.organizationId,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (!lease) {
        throw new ApiError(
          "ACTIVE_LEASE_NOT_FOUND",
          404,
          "Choose an active lease in this workspace.",
        );
      }
      return transaction.invoice.create({
        data: {
          ...values,
          organizationId: membership.organizationId,
          leaseId,
          invoiceNumber,
          status: "DRAFT",
        },
        include: INVOICE_INCLUDE,
      });
    },
    { isolationLevel: "Serializable" },
  );
  return res.status(201).json({
    success: true,
    data: { invoice: serializeInvoice(invoice) },
  });
}

export async function updateInvoice(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const invoiceId = requireUuid(req.params.invoiceId, "invoiceId");
  const body = requireObject(req.body);
  const values = mapInvoiceFields(body, false);

  const invoice = await prisma.$transaction(
    async (transaction) => {
      const current = await transaction.invoice.findFirst({
        where: {
          id: invoiceId,
          organizationId: membership.organizationId,
        },
        include: { payments: { where: { status: "SUCCEEDED" } } },
      });
      if (!current) {
        throw new ApiError("INVOICE_NOT_FOUND", 404, "Invoice not found.");
      }
      if (body.status !== undefined) {
        const status = requireEnum(body.status, INVOICE_STATUSES, "status");
        if (status === "OPEN" && current.status === "DRAFT") {
          values.status = "OPEN";
          values.issuedAt = new Date();
        } else if (
          status === "VOID" &&
          ["DRAFT", "OPEN", "OVERDUE"].includes(current.status) &&
          current.payments.length === 0
        ) {
          values.status = "VOID";
        } else if (status !== current.status) {
          throw new ApiError(
            "INVALID_INVOICE_TRANSITION",
            409,
            "Invoices can only be issued from Draft or voided before any payment is recorded.",
          );
        }
      }
      if (current.status !== "DRAFT" && Object.keys(values).some((key) => key !== "status")) {
        throw new ApiError(
          "INVOICE_NOT_EDITABLE",
          409,
          "Only draft invoices can be edited. Issue or void this invoice instead.",
        );
      }
      if (Object.keys(values).length === 0) {
        throw new ApiError(
          "VALIDATION_ERROR",
          400,
          "Provide at least one invoice field or a valid status change.",
        );
      }

      const combined = {
        subtotal: values.subtotal ?? current.subtotal,
        tax: values.tax ?? current.tax,
        total: values.total ?? current.total,
        dueAt: values.dueAt ?? current.dueAt,
        periodStart:
          values.periodStart === undefined ? current.periodStart : values.periodStart,
        periodEnd:
          values.periodEnd === undefined ? current.periodEnd : values.periodEnd,
      };
      validateInvoiceValues(combined);
      return transaction.invoice.update({
        where: { id: invoiceId },
        data: values,
        include: INVOICE_INCLUDE,
      });
    },
    { isolationLevel: "Serializable" },
  );
  return res.json({
    success: true,
    data: { invoice: serializeInvoice(invoice) },
  });
}

export async function recordInvoicePayment(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const invoiceId = requireUuid(req.params.invoiceId, "invoiceId");
  const body = requireObject(req.body);
  const amount = requireMoney(body.amount, "amount", { min: 0.01 });
  const method =
    body.method === undefined
      ? "OTHER"
      : requireEnum(body.method, PAYMENT_METHODS, "method");
  const currency =
    body.currency === undefined
      ? undefined
      : requireString(body.currency, "currency", 3).toUpperCase();
  if (currency && !/^[A-Z]{3}$/u.test(currency)) {
    throw new ApiError("VALIDATION_ERROR", 400, "currency must be a three-letter ISO code.");
  }
  const notes = optionalString(body.notes, "notes", 2000);

  const result = await prisma.$transaction(
    async (transaction) => {
      const invoice = await transaction.invoice.findFirst({
        where: {
          id: invoiceId,
          organizationId: membership.organizationId,
        },
        include: { payments: { where: { status: "SUCCEEDED" } } },
      });
      if (!invoice) {
        throw new ApiError("INVOICE_NOT_FOUND", 404, "Invoice not found.");
      }
      if (!["OPEN", "PARTIALLY_PAID", "OVERDUE"].includes(invoice.status)) {
        throw new ApiError(
          "INVOICE_NOT_PAYABLE",
          409,
          "Only issued, unpaid invoices can receive a payment.",
        );
      }
      if (currency && currency !== invoice.currency.trim()) {
        throw new ApiError(
          "PAYMENT_CURRENCY_MISMATCH",
          400,
          `Payment currency must match the invoice currency (${invoice.currency.trim()}).`,
        );
      }
      const paidCents = invoice.payments.reduce(
        (sum, payment) => sum + toCents(Number(payment.amount)),
        0,
      );
      const totalCents = toCents(Number(invoice.total));
      const amountCents = toCents(amount);
      if (paidCents + amountCents > totalCents) {
        throw new ApiError(
          "PAYMENT_EXCEEDS_BALANCE",
          400,
          "Payment amount cannot exceed the remaining invoice balance.",
        );
      }

      const now = new Date();
      const payment = await transaction.payment.create({
        data: {
          organizationId: membership.organizationId,
          leaseId: invoice.leaseId,
          invoiceId: invoice.id,
          amount,
          currency: invoice.currency,
          method,
          status: "SUCCEEDED",
          provider: "MANUAL",
          paidAt: now,
          notes,
        },
      });
      const nextPaidCents = paidCents + amountCents;
      const nextStatus =
        nextPaidCents === totalCents
          ? "PAID"
          : invoice.dueAt < startOfToday(now)
            ? "OVERDUE"
            : "PARTIALLY_PAID";
      const updatedInvoice = await transaction.invoice.update({
        where: { id: invoice.id },
        data: {
          status: nextStatus,
          paidAt: nextStatus === "PAID" ? now : null,
        },
        include: INVOICE_INCLUDE,
      });
      return { payment, invoice: updatedInvoice };
    },
    { isolationLevel: "Serializable" },
  );
  return res.status(201).json({
    success: true,
    data: {
      payment: serializePayment(result.payment),
      invoice: serializeInvoice(result.invoice),
    },
  });
}

export async function refundInvoicePayment(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const invoiceId = requireUuid(req.params.invoiceId, "invoiceId");
  const paymentId = requireUuid(req.params.paymentId, "paymentId");
  const body = requireObject(req.body);
  const reason = requireString(body.reason, "reason", 2000);

  const result = await prisma.$transaction(
    async (transaction) => {
      const invoice = await transaction.invoice.findFirst({
        where: {
          id: invoiceId,
          organizationId: membership.organizationId,
        },
        select: { id: true, total: true, dueAt: true },
      });
      if (!invoice) {
        throw new ApiError("INVOICE_NOT_FOUND", 404, "Invoice not found.");
      }
      const payment = await transaction.payment.findFirst({
        where: {
          id: paymentId,
          invoiceId,
          organizationId: membership.organizationId,
          provider: "MANUAL",
          status: "SUCCEEDED",
        },
      });
      if (!payment) {
        throw new ApiError(
          "PAYMENT_NOT_REFUNDABLE",
          404,
          "A successful manual payment was not found for this invoice.",
        );
      }
      const refundedPayment = await transaction.payment.update({
        where: { id: payment.id },
        data: {
          status: "REFUNDED",
          notes: [payment.notes, `Refund recorded: ${reason}`]
            .filter(Boolean)
            .join("\n"),
        },
      });
      const successfulPayments = await transaction.payment.findMany({
        where: {
          invoiceId,
          organizationId: membership.organizationId,
          status: "SUCCEEDED",
        },
        select: { amount: true },
      });
      const paidCents = successfulPayments.reduce(
        (sum, item) => sum + toCents(Number(item.amount)),
        0,
      );
      const totalCents = toCents(Number(invoice.total));
      const now = new Date();
      const status =
        paidCents >= totalCents
          ? "PAID"
          : invoice.dueAt < startOfToday(now)
            ? "OVERDUE"
            : paidCents > 0
              ? "PARTIALLY_PAID"
              : "OPEN";
      const updatedInvoice = await transaction.invoice.update({
        where: { id: invoiceId },
        data: {
          status,
          paidAt: status === "PAID" ? now : null,
        },
        include: INVOICE_INCLUDE,
      });
      return { payment: refundedPayment, invoice: updatedInvoice };
    },
    { isolationLevel: "Serializable" },
  );
  return res.json({
    success: true,
    data: {
      payment: serializePayment(result.payment),
      invoice: serializeInvoice(result.invoice),
    },
  });
}

function mapInvoiceFields(body, creating) {
  const values = {};
  if (creating || body.description !== undefined) {
    values.description = optionalString(body.description, "description", 500);
  }
  if (creating || body.periodStart !== undefined) {
    values.periodStart =
      body.periodStart === undefined || body.periodStart === null || body.periodStart === ""
        ? null
        : parseDate(body.periodStart, "periodStart");
  }
  if (creating || body.periodEnd !== undefined) {
    values.periodEnd =
      body.periodEnd === undefined || body.periodEnd === null || body.periodEnd === ""
        ? null
        : parseDate(body.periodEnd, "periodEnd");
  }
  if (creating || body.dueAt !== undefined) {
    values.dueAt = parseDate(body.dueAt, "dueAt");
  }
  for (const field of ["subtotal", "tax", "total"]) {
    if (creating || body[field] !== undefined) {
      values[field] =
        field === "tax" && body[field] === undefined
          ? 0
          : requireMoney(body[field], field, {
              min: field === "subtotal" ? 0.01 : 0,
            });
    }
  }
  if (creating || body.currency !== undefined) {
    const currency =
      body.currency === undefined ? "USD" : requireString(body.currency, "currency", 3);
    values.currency = currency.toUpperCase();
    if (!/^[A-Z]{3}$/u.test(values.currency)) {
      throw new ApiError("VALIDATION_ERROR", 400, "currency must be a three-letter ISO code.");
    }
  }
  return values;
}

function validateInvoiceValues({ subtotal, tax, total, dueAt, periodStart, periodEnd }) {
  if (toCents(Number(subtotal)) + toCents(Number(tax)) !== toCents(Number(total))) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "total must equal subtotal plus tax.",
    );
  }
  if (
    periodStart &&
    periodEnd &&
    periodEnd < periodStart
  ) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "periodEnd cannot be before periodStart.",
    );
  }
  if (!(dueAt instanceof Date) || Number.isNaN(dueAt.getTime())) {
    throw new ApiError("VALIDATION_ERROR", 400, "dueAt is required.");
  }
}

function requireMoney(value, field, { min = 0 } = {}) {
  const amount = requireNumber(value, field, { min, max: 9999999999.99 });
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      `${field} cannot have more than two decimal places.`,
    );
  }
  return amount;
}

function toCents(amount) {
  return Math.round(amount * 100);
}

function parseDate(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new ApiError("VALIDATION_ERROR", 400, `${field} must use YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== value) {
    throw new ApiError("VALIDATION_ERROR", 400, `${field} must be a valid calendar date.`);
  }
  return date;
}

function createInvoiceNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `INV-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function markInvoiceOverdue(invoiceId, organizationId) {
  await prisma.invoice.updateMany({
    where: {
      id: invoiceId,
      organizationId,
      status: { in: ["OPEN", "PARTIALLY_PAID"] },
      dueAt: { lt: startOfToday(new Date()) },
    },
    data: { status: "OVERDUE" },
  });
}

function startOfToday(date) {
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function ensureCanWrite(role) {
  if (!FINANCE_WRITERS.includes(role)) {
    throw new ApiError(
      "INSUFFICIENT_PERMISSIONS",
      403,
      "You do not have permission to change invoices or record payments.",
    );
  }
}

function serializeInvoice(invoice) {
  const paidCents = invoice.payments
    .filter((payment) => payment.status === "SUCCEEDED")
    .reduce((sum, payment) => sum + toCents(Number(payment.amount)), 0);
  return {
    ...invoice,
    currency: invoice.currency.trim(),
    amountPaid: (paidCents / 100).toFixed(2),
    balanceDue: ((toCents(Number(invoice.total)) - paidCents) / 100).toFixed(2),
    payments: invoice.payments.map(serializePayment),
  };
}

function serializePayment(payment) {
  return { ...payment, currency: payment.currency.trim() };
}
