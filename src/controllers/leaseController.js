import { extname } from "node:path";
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
import {
  deletePrivateDocument,
  getPrivateDocumentDownloadUrl,
  uploadPrivateDocument,
} from "../services/cloudinaryService.js";

const LEASE_STATUSES = ["DRAFT", "PENDING", "ACTIVE", "ENDED", "TERMINATED"];
const LEASE_WRITERS = ["OWNER", "ADMIN", "PROPERTY_MANAGER"];
const BOOKING_STATUSES = ["PENDING", "ACTIVE"];
const LEASE_INCLUDE = {
  tenant: true,
  unit: { include: { property: true } },
  documents: { orderBy: { createdAt: "desc" } },
};

export async function listLeases(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const where = { organizationId: membership.organizationId };
  if (req.query.status !== undefined) {
    where.status = requireEnum(req.query.status, LEASE_STATUSES, "status");
  }
  if (req.query.unitId !== undefined) {
    where.unitId = requireUuid(req.query.unitId, "unitId");
  }

  const leases = await prisma.lease.findMany({
    where,
    include: LEASE_INCLUDE,
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });
  return res.json({ success: true, data: { leases: leases.map(serializeLease) } });
}

export async function getLeaseOptions(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const [units, tenants] = await Promise.all([
    prisma.unit.findMany({
      where: {
        property: { organizationId: membership.organizationId },
        status: { notIn: ["MAINTENANCE", "INACTIVE"] },
      },
      include: { property: { select: { id: true, name: true } } },
      orderBy: [{ property: { name: "asc" } }, { unitNumber: "asc" }],
    }),
    prisma.tenant.findMany({
      where: { organizationId: membership.organizationId },
      select: { id: true, fullName: true, email: true, phone: true },
      orderBy: { fullName: "asc" },
    }),
  ]);
  return res.json({ success: true, data: { units, tenants } });
}

export async function getLease(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const leaseId = requireUuid(req.params.leaseId, "leaseId");
  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, organizationId: membership.organizationId },
    include: LEASE_INCLUDE,
  });
  if (!lease) {
    throw new ApiError("LEASE_NOT_FOUND", 404, "Lease not found.");
  }
  return res.json({ success: true, data: { lease: serializeLease(lease) } });
}

export async function createLease(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const body = requireObject(req.body);
  const data = mapLeaseFields(body, true);
  const status =
    body.status === undefined
      ? "DRAFT"
      : requireEnum(body.status, LEASE_STATUSES, "status");
  if (!["DRAFT", "PENDING", "ACTIVE"].includes(status)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "A new lease must start as DRAFT, PENDING, or ACTIVE.",
    );
  }
  validateDateRange(data.startDate, data.endDate);
  validateActiveDates(status, data.startDate, data.endDate);
  data.status = status;

  const lease = await prisma.$transaction(
    async (transaction) => {
      await requireUnit(transaction, data.unitId, membership.organizationId);
      const tenantId = await resolveTenant(
        transaction,
        body,
        membership.organizationId,
      );
      await ensureNoLeaseConflict(transaction, {
        unitId: data.unitId,
        startDate: data.startDate,
        endDate: data.endDate,
        status,
      });

      const created = await transaction.lease.create({
        data: {
          ...data,
          organizationId: membership.organizationId,
          tenantId,
        },
        include: LEASE_INCLUDE,
      });
      if (BOOKING_STATUSES.includes(status)) {
        await syncUnitStatus(transaction, data.unitId);
      }
      return created;
    },
    { isolationLevel: "Serializable" },
  );
  return res
    .status(201)
    .json({ success: true, data: { lease: serializeLease(lease) } });
}

export async function updateLease(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const leaseId = requireUuid(req.params.leaseId, "leaseId");
  const body = requireObject(req.body);
  const data = mapLeaseFields(body, false);

  const lease = await prisma.$transaction(
    async (transaction) => {
      const current = await transaction.lease.findFirst({
        where: { id: leaseId, organizationId: membership.organizationId },
      });
      if (!current) {
        throw new ApiError("LEASE_NOT_FOUND", 404, "Lease not found.");
      }

      if (body.status !== undefined) {
        const nextStatus = requireEnum(body.status, LEASE_STATUSES, "status");
        validateStatusTransition(current.status, nextStatus);
        data.status = nextStatus;
      }
      if (Object.keys(data).length === 0) {
        throw new ApiError(
          "VALIDATION_ERROR",
          400,
          "At least one lease field is required.",
        );
      }

      const startDate = data.startDate ?? current.startDate;
      const endDate = data.endDate === undefined ? current.endDate : data.endDate;
      validateDateRange(startDate, endDate);
      const status = data.status ?? current.status;
      validateActiveDates(status, startDate, endDate);

      const nextUnitId = data.unitId ?? current.unitId;
      if (
        (data.unitId !== undefined && data.unitId !== current.unitId) ||
        (status === "ACTIVE" && current.status !== "ACTIVE")
      ) {
        await requireUnit(transaction, nextUnitId, membership.organizationId);
      }
      await ensureNoLeaseConflict(transaction, {
        unitId: nextUnitId,
        startDate,
        endDate,
        status,
        excludeLeaseId: leaseId,
      });

      if (status === "TERMINATED" && current.status !== "TERMINATED") {
        data.terminatedAt = new Date();
      }
      if (status !== "ACTIVE" && current.status === "ACTIVE") {
        data.terminatedAt = status === "TERMINATED" ? new Date() : null;
      }

      const updated = await transaction.lease.update({
        where: { id: leaseId },
        data,
        include: LEASE_INCLUDE,
      });

      if (status !== current.status || current.unitId !== nextUnitId) {
        if (current.unitId !== nextUnitId) {
          await syncUnitStatus(transaction, current.unitId);
        }
        await syncUnitStatus(transaction, nextUnitId);
      }
      return updated;
    },
    { isolationLevel: "Serializable" },
  );
  return res.json({ success: true, data: { lease: serializeLease(lease) } });
}

export async function uploadLeaseDocument(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const leaseId = requireUuid(req.params.leaseId, "leaseId");
  if (!req.file) {
    throw new ApiError("DOCUMENT_REQUIRED", 400, "Choose a document to upload.");
  }
  const fileExtension = extname(req.file.originalname).slice(1).toLowerCase();
  const allowedExtensions = {
    "application/pdf": ["pdf"],
    "application/msword": ["doc"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
      "docx",
    ],
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
  };
  if (!allowedExtensions[req.file.mimetype]?.includes(fileExtension)) {
    throw new ApiError(
      "INVALID_DOCUMENT_TYPE",
      400,
      "The document filename extension must match its file type.",
    );
  }

  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, organizationId: membership.organizationId },
    select: { id: true },
  });
  if (!lease) {
    throw new ApiError("LEASE_NOT_FOUND", 404, "Lease not found.");
  }

  const uploaded = await uploadPrivateDocument(req.file.buffer, req.file.originalname);
  try {
    const document = await prisma.document.create({
      data: {
        organizationId: membership.organizationId,
        uploadedById: req.authUserId,
        leaseId,
        name: normalizeFileName(req.file.originalname),
        storagePath: uploaded.public_id,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
      },
    });
    return res.status(201).json({
      success: true,
      data: { document: serializeDocument(document) },
    });
  } catch (error) {
    try {
      await deletePrivateDocument(uploaded.public_id);
    } catch (cleanupError) {
      console.error("Failed to remove an unrecorded lease document:", cleanupError);
    }
    throw error;
  }
}

export async function downloadLeaseDocument(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const leaseId = requireUuid(req.params.leaseId, "leaseId");
  const documentId = requireUuid(req.params.documentId, "documentId");
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      leaseId,
      organizationId: membership.organizationId,
    },
    select: { storagePath: true, name: true },
  });
  if (!document) {
    throw new ApiError("DOCUMENT_NOT_FOUND", 404, "Lease document not found.");
  }
  const downloadUrl = getPrivateDocumentDownloadUrl(
    document.storagePath,
    extname(document.name).slice(1).toLowerCase(),
  );
  return res.json({ success: true, data: { downloadUrl } });
}

export async function deleteLeaseDocument(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const leaseId = requireUuid(req.params.leaseId, "leaseId");
  const documentId = requireUuid(req.params.documentId, "documentId");
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      leaseId,
      organizationId: membership.organizationId,
    },
    select: { id: true, storagePath: true },
  });
  if (!document) {
    throw new ApiError("DOCUMENT_NOT_FOUND", 404, "Lease document not found.");
  }
  await deletePrivateDocument(document.storagePath);
  await prisma.document.delete({ where: { id: document.id } });
  return res.json({ success: true, data: { deleted: true } });
}

async function requireUnit(transaction, unitId, organizationId) {
  const unit = await transaction.unit.findFirst({
    where: { id: unitId, property: { organizationId } },
    select: { id: true, status: true },
  });
  if (!unit) {
    throw new ApiError("UNIT_NOT_FOUND", 404, "Unit not found.");
  }
  if (["MAINTENANCE", "INACTIVE"].includes(unit.status)) {
    throw new ApiError(
      "UNIT_NOT_RENTABLE",
      409,
      "A unit in maintenance or inactive status cannot be leased.",
    );
  }
  return unit;
}

async function resolveTenant(transaction, body, organizationId) {
  if (body.tenantId !== undefined) {
    const tenantId = requireUuid(body.tenantId, "tenantId");
    const tenant = await transaction.tenant.findFirst({
      where: { id: tenantId, organizationId },
      select: { id: true },
    });
    if (!tenant) {
      throw new ApiError("TENANT_NOT_FOUND", 404, "Tenant not found.");
    }
    return tenant.id;
  }

  const tenantBody = requireObject(body.tenant);
  const fullName = requireString(tenantBody.fullName, "tenant.fullName", 160);
  const email = optionalString(tenantBody.email, "tenant.email", 320);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new ApiError("VALIDATION_ERROR", 400, "tenant.email must be a valid email address.");
  }
  const tenant = await transaction.tenant.create({
    data: {
      organizationId,
      fullName,
      email,
      phone: optionalString(tenantBody.phone, "tenant.phone", 40),
    },
    select: { id: true },
  });
  return tenant.id;
}

function mapLeaseFields(body, creating) {
  const data = {};
  if (creating || body.unitId !== undefined) {
    data.unitId = requireUuid(body.unitId, "unitId");
  }
  if (creating || body.startDate !== undefined) {
    data.startDate = parseDate(body.startDate, "startDate");
  }
  if (body.endDate !== undefined) {
    data.endDate = body.endDate === null || body.endDate === ""
      ? null
      : parseDate(body.endDate, "endDate");
  }
  if (creating || body.monthlyRent !== undefined) {
    data.monthlyRent = requireNumber(body.monthlyRent, "monthlyRent", {
      min: 0.01,
      max: 9999999999.99,
    });
  }
  if (body.securityDeposit !== undefined || creating) {
    data.securityDeposit =
      body.securityDeposit === undefined
        ? 0
        : requireNumber(body.securityDeposit, "securityDeposit", {
            max: 9999999999.99,
          });
  }
  if (body.rentDueDay !== undefined || creating) {
    data.rentDueDay =
      body.rentDueDay === undefined
        ? 1
        : requireNumber(body.rentDueDay, "rentDueDay", { min: 1, max: 31 });
    if (!Number.isInteger(data.rentDueDay)) {
      throw new ApiError("VALIDATION_ERROR", 400, "rentDueDay must be a whole number.");
    }
  }
  if (body.lateFee !== undefined) {
    data.lateFee =
      body.lateFee === null || body.lateFee === ""
        ? null
        : requireNumber(body.lateFee, "lateFee", { max: 9999999999.99 });
  }
  if (body.terms !== undefined) {
    data.terms = optionalString(body.terms, "terms", 20000);
  }
  return data;
}

function parseDate(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new ApiError("VALIDATION_ERROR", 400, `${fieldName} must be a valid YYYY-MM-DD date.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== value) {
    throw new ApiError("VALIDATION_ERROR", 400, `${fieldName} must be a valid YYYY-MM-DD date.`);
  }
  return date;
}

function validateDateRange(startDate, endDate) {
  if (endDate && endDate < startDate) {
    throw new ApiError("VALIDATION_ERROR", 400, "endDate cannot be before startDate.");
  }
}

function validateActiveDates(status, startDate, endDate) {
  if (status !== "ACTIVE") {
    return;
  }
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (startDate > today || (endDate && endDate < today)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "An active lease must include today's date; use PENDING for a future lease.",
    );
  }
}

function validateStatusTransition(current, next) {
  const transitions = {
    DRAFT: ["PENDING", "ACTIVE", "TERMINATED"],
    PENDING: ["ACTIVE", "TERMINATED"],
    ACTIVE: ["ENDED", "TERMINATED"],
    ENDED: [],
    TERMINATED: [],
  };
  if (current !== next && !transitions[current].includes(next)) {
    throw new ApiError(
      "INVALID_LEASE_TRANSITION",
      409,
      `A ${current.toLowerCase()} lease cannot be changed to ${next.toLowerCase()}.`,
    );
  }
}

async function ensureNoLeaseConflict(
  transaction,
  { unitId, startDate, endDate, status, excludeLeaseId },
) {
  if (!BOOKING_STATUSES.includes(status)) {
    return;
  }
  const leases = await transaction.lease.findMany({
    where: {
      unitId,
      status: { in: BOOKING_STATUSES },
      ...(excludeLeaseId ? { id: { not: excludeLeaseId } } : {}),
    },
    select: { id: true, startDate: true, endDate: true },
  });
  const hasConflict = leases.some((lease) => {
    const existingEnd = lease.endDate ?? new Date("9999-12-31T00:00:00.000Z");
    const requestedEnd = endDate ?? new Date("9999-12-31T00:00:00.000Z");
    return startDate <= existingEnd && lease.startDate <= requestedEnd;
  });
  if (hasConflict) {
    throw new ApiError(
      "UNIT_LEASE_CONFLICT",
      409,
      "This unit already has a pending or active lease for overlapping dates.",
    );
  }
}

async function syncUnitStatus(transaction, unitId) {
  const unit = await transaction.unit.findFirst({
    where: { id: unitId },
    select: { status: true },
  });
  if (!unit || ["MAINTENANCE", "INACTIVE"].includes(unit.status)) {
    return;
  }
  const [activeLease, pendingLease] = await Promise.all([
    transaction.lease.findFirst({
      where: { unitId, status: "ACTIVE" },
      select: { id: true },
    }),
    transaction.lease.findFirst({
      where: { unitId, status: "PENDING" },
      select: { id: true },
    }),
  ]);
  const status = activeLease ? "OCCUPIED" : pendingLease ? "RESERVED" : "AVAILABLE";
  if (status !== unit.status) {
    await transaction.unit.update({
      where: { id: unitId },
      data: { status },
    });
  }
}

function ensureCanWrite(role) {
  if (!LEASE_WRITERS.includes(role)) {
    throw new ApiError(
      "INSUFFICIENT_PERMISSIONS",
      403,
      "You do not have permission to change leases.",
    );
  }
}

function normalizeFileName(fileName) {
  return fileName.replace(/[\\/]/gu, "_").slice(0, 255);
}

function serializeLease(lease) {
  return {
    ...lease,
    documents: lease.documents.map(serializeDocument),
  };
}

function serializeDocument(document) {
  return {
    ...document,
    sizeBytes:
      document.sizeBytes === null || document.sizeBytes === undefined
        ? document.sizeBytes
        : document.sizeBytes.toString(),
  };
}
