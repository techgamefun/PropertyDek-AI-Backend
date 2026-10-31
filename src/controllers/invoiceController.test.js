import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentMembership: vi.fn(),
  leaseFindFirst: vi.fn(),
  invoiceUpdateMany: vi.fn(),
  invoiceFindMany: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceCreate: vi.fn(),
  invoiceUpdate: vi.fn(),
  paymentCreate: vi.fn(),
  paymentFindFirst: vi.fn(),
  paymentFindMany: vi.fn(),
  paymentUpdate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../config/prismaClient.js", () => ({
  default: {
    $transaction: mocks.transaction,
    invoice: {
      updateMany: mocks.invoiceUpdateMany,
      findMany: mocks.invoiceFindMany,
    },
    lease: { findMany: vi.fn() },
  },
}));

vi.mock("../services/organizationAccess.js", () => ({
  requireCurrentMembership: mocks.requireCurrentMembership,
  requireUuid: (value) => value,
}));

import {
  createInvoice,
  listInvoices,
  recordInvoicePayment,
  refundInvoicePayment,
  updateInvoice,
} from "./invoiceController.js";

describe("invoiceController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentMembership.mockResolvedValue({
      organizationId: "org-123",
      role: "OWNER",
    });
    mocks.leaseFindFirst.mockResolvedValue({ id: "lease-123" });
    mocks.invoiceFindMany.mockResolvedValue([]);
    mocks.invoiceFindFirst.mockResolvedValue({
      id: "invoice-123",
      organizationId: "org-123",
      leaseId: "lease-123",
      invoiceNumber: "INV-20261031-ABC12345",
      status: "DRAFT",
      dueAt: new Date("2026-12-01T00:00:00.000Z"),
      subtotal: "100.00",
      tax: "5.00",
      total: "105.00",
      currency: "USD",
      paidAt: null,
      payments: [],
    });
    mocks.invoiceCreate.mockImplementation(async ({ data }) => ({
      ...data,
      id: "invoice-123",
      payments: [],
    }));
    mocks.invoiceUpdate.mockImplementation(async ({ data }) => ({
      ...data,
      id: "invoice-123",
      invoiceNumber: "INV-20261031-ABC12345",
      status: data.status ?? "DRAFT",
      dueAt: data.dueAt ?? new Date("2026-12-01T00:00:00.000Z"),
      subtotal: data.subtotal ?? "100.00",
      tax: data.tax ?? "5.00",
      total: data.total ?? "105.00",
      currency: data.currency ?? "USD",
      payments: [],
    }));
    mocks.paymentCreate.mockImplementation(async ({ data }) => ({
      ...data,
      id: "payment-123",
    }));
    mocks.paymentFindFirst.mockResolvedValue({
      id: "payment-123",
      notes: null,
    });
    mocks.paymentFindMany.mockResolvedValue([]);
    mocks.paymentUpdate.mockImplementation(async ({ data }) => ({
      id: "payment-123",
      amount: "20.00",
      currency: "USD",
      method: "CASH",
      provider: "MANUAL",
      ...data,
    }));
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        lease: { findFirst: mocks.leaseFindFirst },
        invoice: {
          findFirst: mocks.invoiceFindFirst,
          create: mocks.invoiceCreate,
          update: mocks.invoiceUpdate,
        },
        payment: {
          create: mocks.paymentCreate,
          findFirst: mocks.paymentFindFirst,
          findMany: mocks.paymentFindMany,
          update: mocks.paymentUpdate,
        },
      }),
    );
  });

  it("only marks invoices overdue after their due date has passed", async () => {
    const res = { json: vi.fn().mockReturnThis() };
    await listInvoices(
      { authUserId: "user-123", query: {} },
      res,
    );
    expect(mocks.invoiceUpdateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-123",
        status: { in: ["OPEN", "PARTIALLY_PAID"] },
        dueAt: {
          lt: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
        },
      },
      data: { status: "OVERDUE" },
    });
  });

  it("creates a draft invoice only for an active workspace lease", async () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await createInvoice(
      {
        authUserId: "user-123",
        body: {
          leaseId: "lease-123",
          description: "Monthly rent",
          dueAt: "2026-12-01",
          subtotal: 100,
          tax: 5,
          total: 105,
          currency: "usd",
        },
      },
      res,
    );

    expect(mocks.leaseFindFirst).toHaveBeenCalledWith({
      where: {
        id: "lease-123",
        organizationId: "org-123",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    expect(mocks.invoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-123",
          leaseId: "lease-123",
          status: "DRAFT",
          subtotal: 100,
          tax: 5,
          total: 105,
          currency: "USD",
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects totals that do not equal subtotal plus tax", async () => {
    await expect(
      createInvoice(
        {
          authUserId: "user-123",
          body: {
            leaseId: "lease-123",
            dueAt: "2026-12-01",
            subtotal: 100,
            tax: 5,
            total: 110,
          },
        },
        { status: vi.fn(), json: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("issues a draft and records partial payment without exceeding its balance", async () => {
    const issueResponse = { json: vi.fn().mockReturnThis() };
    await updateInvoice(
      {
        authUserId: "user-123",
        params: { invoiceId: "invoice-123" },
        body: { status: "OPEN" },
      },
      issueResponse,
    );
    expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "OPEN", issuedAt: expect.any(Date) }),
      }),
    );

    mocks.invoiceFindFirst.mockResolvedValue({
      id: "invoice-123",
      organizationId: "org-123",
      leaseId: "lease-123",
      status: "OPEN",
      dueAt: new Date("2099-12-01T00:00:00.000Z"),
      total: "105.00",
      currency: "USD",
      payments: [],
    });
    const paymentResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    await recordInvoicePayment(
      {
        authUserId: "user-123",
        params: { invoiceId: "invoice-123" },
        body: { amount: 40, method: "BANK_TRANSFER" },
      },
      paymentResponse,
    );
    expect(mocks.paymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-123",
        invoiceId: "invoice-123",
        leaseId: "lease-123",
        amount: 40,
        currency: "USD",
        method: "BANK_TRANSFER",
        status: "SUCCEEDED",
        provider: "MANUAL",
        paidAt: expect.any(Date),
      }),
    });
    expect(mocks.invoiceUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { status: "PARTIALLY_PAID", paidAt: null },
      }),
    );
    expect(paymentResponse.status).toHaveBeenCalledWith(201);
  });

  it("rejects a payment larger than the remaining balance", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({
      id: "invoice-123",
      organizationId: "org-123",
      leaseId: "lease-123",
      status: "PARTIALLY_PAID",
      dueAt: new Date("2099-12-01T00:00:00.000Z"),
      total: "105.00",
      currency: "USD",
      payments: [{ amount: "80.00", status: "SUCCEEDED" }],
    });

    await expect(
      recordInvoicePayment(
        {
          authUserId: "user-123",
          params: { invoiceId: "invoice-123" },
          body: { amount: 30, method: "CASH" },
        },
        { status: vi.fn(), json: vi.fn() },
      ),
    ).rejects.toMatchObject({
      code: "PAYMENT_EXCEEDS_BALANCE",
      statusCode: 400,
    });
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
  });

  it("marks the invoice paid after the full remaining balance is received", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({
      id: "invoice-123",
      organizationId: "org-123",
      leaseId: "lease-123",
      status: "PARTIALLY_PAID",
      dueAt: new Date("2099-12-01T00:00:00.000Z"),
      total: "105.00",
      currency: "USD",
      payments: [{ amount: "80.00", status: "SUCCEEDED" }],
    });

    await recordInvoicePayment(
      {
        authUserId: "user-123",
        params: { invoiceId: "invoice-123" },
        body: { amount: 25, method: "CHECK" },
      },
      { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() },
    );
    expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "PAID", paidAt: expect.any(Date) },
      }),
    );
  });

  it("records an external refund and restores the unpaid invoice balance", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({
      id: "invoice-123",
      total: "105.00",
      dueAt: new Date("2099-12-01T00:00:00.000Z"),
    });
    mocks.paymentFindFirst.mockResolvedValue({
      id: "payment-123",
      notes: "Bank reference 123",
      provider: "MANUAL",
      status: "SUCCEEDED",
    });
    const res = { json: vi.fn().mockReturnThis() };
    await refundInvoicePayment(
      {
        authUserId: "user-123",
        params: { invoiceId: "invoice-123", paymentId: "payment-123" },
        body: { reason: "Duplicate receipt entry" },
      },
      res,
    );
    expect(mocks.paymentUpdate).toHaveBeenCalledWith({
      where: { id: "payment-123" },
      data: {
        status: "REFUNDED",
        notes: "Bank reference 123\nRefund recorded: Duplicate receipt entry",
      },
    });
    expect(mocks.invoiceUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { status: "OPEN", paidAt: null },
      }),
    );
  });

  it("prevents editing an issued invoice", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({
      id: "invoice-123",
      organizationId: "org-123",
      status: "OPEN",
      dueAt: new Date("2026-12-01T00:00:00.000Z"),
      subtotal: "100.00",
      tax: "5.00",
      total: "105.00",
      periodStart: null,
      periodEnd: null,
      payments: [],
    });
    await expect(
      updateInvoice(
        {
          authUserId: "user-123",
          params: { invoiceId: "invoice-123" },
          body: { subtotal: 120, total: 125 },
        },
        { json: vi.fn() },
      ),
    ).rejects.toMatchObject({
      code: "INVOICE_NOT_EDITABLE",
      statusCode: 409,
    });
    expect(mocks.invoiceUpdate).not.toHaveBeenCalled();
  });
});
