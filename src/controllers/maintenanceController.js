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
  requireObject,
  requireString,
} from "../services/requestValidation.js";
import {
  deletePrivateDocument,
  getPrivateDocumentDownloadUrl,
  uploadPrivateDocument,
} from "../services/cloudinaryService.js";

const STATUSES = ["OPEN", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const REQUEST_WRITERS = ["OWNER", "ADMIN", "PROPERTY_MANAGER", "MAINTENANCE"];
const MANAGERS = ["OWNER", "ADMIN", "PROPERTY_MANAGER"];
const REQUEST_INCLUDE = {
  property: { select: { id: true, name: true } },
  unit: { select: { id: true, unitNumber: true } },
  tenant: { select: { id: true, fullName: true, email: true, phone: true } },
  assignments: {
    include: {
      technician: {
        select: { id: true, fullName: true, email: true, phone: true, specialties: true },
      },
    },
    orderBy: { assignedAt: "desc" },
  },
  comments: {
    include: {
      authorUser: { select: { id: true, fullName: true } },
      authorTenant: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  documents: {
    select: {
      id: true,
      name: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
      uploadedBy: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
  },
};

export async function listMaintenanceRequests(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const where = { organizationId: membership.organizationId };
  if (req.query.status !== undefined && req.query.status !== "ALL") {
    where.status = requireEnum(req.query.status, STATUSES, "status");
  }
  if (req.query.priority !== undefined && req.query.priority !== "ALL") {
    where.priority = requireEnum(req.query.priority, PRIORITIES, "priority");
  }
  if (req.query.propertyId !== undefined && req.query.propertyId !== "ALL") {
    where.propertyId = requireUuid(req.query.propertyId, "propertyId");
  }
  const requests = await prisma.maintenanceRequest.findMany({
    where,
    include: {
      property: { select: { id: true, name: true } },
      unit: { select: { id: true, unitNumber: true } },
      tenant: { select: { id: true, fullName: true } },
      assignments: {
        where: { status: { not: "CANCELLED" } },
        include: {
          technician: { select: { id: true, fullName: true, specialties: true } },
        },
        orderBy: { assignedAt: "desc" },
      },
      _count: { select: { comments: true } },
    },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { requestedAt: "desc" }],
  });
  return res.json({ success: true, data: { requests } });
}

export async function getMaintenanceOptions(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const [properties, technicians] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId: membership.organizationId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        units: {
          select: { id: true, unitNumber: true, status: true },
          orderBy: { unitNumber: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.technician.findMany({
      where: { organizationId: membership.organizationId, isActive: true },
      select: { id: true, fullName: true, email: true, phone: true, specialties: true },
      orderBy: { fullName: "asc" },
    }),
  ]);
  return res.json({ success: true, data: { properties, technicians } });
}

export async function getMaintenanceRequest(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const requestId = requireUuid(req.params.requestId, "requestId");
  const request = await prisma.maintenanceRequest.findFirst({
    where: { id: requestId, organizationId: membership.organizationId },
    include: REQUEST_INCLUDE,
  });
  if (!request) {
    throw new ApiError("MAINTENANCE_NOT_FOUND", 404, "Maintenance request not found.");
  }
  return res.json({ success: true, data: { request: serializeMaintenanceRequest(request) } });
}

export async function createMaintenanceRequest(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWriteRequest(membership.role);
  const body = requireObject(req.body);
  const propertyId = requireUuid(body.propertyId, "propertyId");
  const unitId = body.unitId ? requireUuid(body.unitId, "unitId") : null;
  const tenantId = body.tenantId ? requireUuid(body.tenantId, "tenantId") : null;
  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId: membership.organizationId },
    select: { id: true },
  });
  if (!property) {
    throw new ApiError("PROPERTY_NOT_FOUND", 404, "Choose a property in this workspace.");
  }
  if (unitId) {
    const unit = await prisma.unit.findFirst({
      where: { id: unitId, propertyId },
      select: { id: true },
    });
    if (!unit) {
      throw new ApiError("UNIT_NOT_FOUND", 404, "Choose a unit in the selected property.");
    }
  }
  if (tenantId) {
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, organizationId: membership.organizationId },
      select: { id: true },
    });
    if (!tenant) {
      throw new ApiError("TENANT_NOT_FOUND", 404, "Tenant not found in this workspace.");
    }
  }
  const request = await prisma.maintenanceRequest.create({
    data: {
      organizationId: membership.organizationId,
      propertyId,
      unitId,
      tenantId,
      title: requireString(body.title, "title", 200),
      description: requireString(body.description, "description", 10000),
      category: optionalString(body.category, "category", 80),
      priority:
        body.priority === undefined
          ? "MEDIUM"
          : requireEnum(body.priority, PRIORITIES, "priority"),
      scheduledAt: parseOptionalDate(body.scheduledAt, "scheduledAt"),
    },
    include: REQUEST_INCLUDE,
  });
  return res.status(201).json({
    success: true,
    data: { request: serializeMaintenanceRequest(request) },
  });
}

export async function updateMaintenanceRequest(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWriteRequest(membership.role);
  const requestId = requireUuid(req.params.requestId, "requestId");
  const body = requireObject(req.body);
  const data = {};
  if (body.title !== undefined) {
    data.title = requireString(body.title, "title", 200);
  }
  if (body.description !== undefined) {
    data.description = requireString(body.description, "description", 10000);
  }
  if (body.category !== undefined) {
    data.category = optionalString(body.category, "category", 80);
  }
  if (body.priority !== undefined) {
    data.priority = requireEnum(body.priority, PRIORITIES, "priority");
  }
  if (body.status !== undefined) {
    data.status = requireEnum(body.status, STATUSES, "status");
    data.completedAt = body.status === "COMPLETED" ? new Date() : null;
  }
  if (body.scheduledAt !== undefined) {
    data.scheduledAt = parseOptionalDate(body.scheduledAt, "scheduledAt");
  }
  if (Object.keys(data).length === 0) {
    throw new ApiError("VALIDATION_ERROR", 400, "Provide at least one request field to update.");
  }
  const existing = await prisma.maintenanceRequest.findFirst({
    where: { id: requestId, organizationId: membership.organizationId },
    select: { id: true },
  });
  if (!existing) {
    throw new ApiError("MAINTENANCE_NOT_FOUND", 404, "Maintenance request not found.");
  }
  const request = await prisma.maintenanceRequest.update({
    where: { id: requestId },
    data,
    include: REQUEST_INCLUDE,
  });
  return res.json({ success: true, data: { request: serializeMaintenanceRequest(request) } });
}

export async function uploadMaintenanceDocument(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWriteRequest(membership.role);
  const requestId = requireUuid(req.params.requestId, "requestId");
  if (!req.file) {
    throw new ApiError("DOCUMENT_REQUIRED", 400, "Choose a document to upload.");
  }
  const fileExtension = extname(req.file.originalname).slice(1).toLowerCase();
  const allowedExtensions = {
    "application/pdf": ["pdf"],
    "application/msword": ["doc"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
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
  const request = await prisma.maintenanceRequest.findFirst({
    where: { id: requestId, organizationId: membership.organizationId },
    select: { id: true },
  });
  if (!request) {
    throw new ApiError("MAINTENANCE_NOT_FOUND", 404, "Maintenance request not found.");
  }
  const uploaded = await uploadPrivateDocument(req.file.buffer, req.file.originalname);
  try {
    const document = await prisma.document.create({
      data: {
        organizationId: membership.organizationId,
        uploadedById: req.authUserId,
        maintenanceRequestId: requestId,
        name: normalizeFileName(req.file.originalname),
        storagePath: uploaded.public_id,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
      },
      select: {
        id: true,
        name: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
        uploadedBy: { select: { id: true, fullName: true } },
      },
    });
    return res.status(201).json({
      success: true,
      data: { document: serializeMaintenanceDocument(document) },
    });
  } catch (error) {
    try {
      await deletePrivateDocument(uploaded.public_id);
    } catch (cleanupError) {
      console.error("Failed to remove an unrecorded maintenance document:", cleanupError);
    }
    throw error;
  }
}

export async function downloadMaintenanceDocument(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const requestId = requireUuid(req.params.requestId, "requestId");
  const documentId = requireUuid(req.params.documentId, "documentId");
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      maintenanceRequestId: requestId,
      organizationId: membership.organizationId,
    },
    select: { storagePath: true, name: true },
  });
  if (!document) {
    throw new ApiError("DOCUMENT_NOT_FOUND", 404, "Maintenance document not found.");
  }
  const downloadUrl = getPrivateDocumentDownloadUrl(
    document.storagePath,
    extname(document.name).slice(1).toLowerCase(),
  );
  return res.json({ success: true, data: { downloadUrl } });
}

export async function deleteMaintenanceDocument(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWriteRequest(membership.role);
  const requestId = requireUuid(req.params.requestId, "requestId");
  const documentId = requireUuid(req.params.documentId, "documentId");
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      maintenanceRequestId: requestId,
      organizationId: membership.organizationId,
    },
    select: { id: true, storagePath: true },
  });
  if (!document) {
    throw new ApiError("DOCUMENT_NOT_FOUND", 404, "Maintenance document not found.");
  }
  await deletePrivateDocument(document.storagePath);
  await prisma.document.delete({ where: { id: document.id } });
  return res.json({ success: true, data: { deleted: true } });
}

export async function addMaintenanceComment(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWriteRequest(membership.role);
  const requestId = requireUuid(req.params.requestId, "requestId");
  const body = requireObject(req.body);
  const isInternal = body.isInternal === undefined ? false : body.isInternal;
  if (typeof isInternal !== "boolean") {
    throw new ApiError("VALIDATION_ERROR", 400, "isInternal must be a boolean.");
  }
  if (isInternal && !MANAGERS.includes(membership.role)) {
    throw new ApiError("INSUFFICIENT_PERMISSIONS", 403, "Only workspace managers can add internal notes.");
  }
  const exists = await prisma.maintenanceRequest.findFirst({
    where: { id: requestId, organizationId: membership.organizationId },
    select: { id: true },
  });
  if (!exists) {
    throw new ApiError("MAINTENANCE_NOT_FOUND", 404, "Maintenance request not found.");
  }
  const comment = await prisma.maintenanceComment.create({
    data: {
      maintenanceRequestId: requestId,
      authorUserId: req.authUserId,
      body: requireString(body.body, "body", 5000),
      isInternal,
    },
    include: {
      authorUser: { select: { id: true, fullName: true } },
      authorTenant: { select: { id: true, fullName: true } },
    },
  });
  return res.status(201).json({ success: true, data: { comment } });
}

export async function assignTechnician(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWriteRequest(membership.role);
  const requestId = requireUuid(req.params.requestId, "requestId");
  const body = requireObject(req.body);
  const technicianId = requireUuid(body.technicianId, "technicianId");
  const request = await prisma.maintenanceRequest.findFirst({
    where: { id: requestId, organizationId: membership.organizationId },
    select: { id: true },
  });
  if (!request) {
    throw new ApiError("MAINTENANCE_NOT_FOUND", 404, "Maintenance request not found.");
  }
  const technician = await prisma.technician.findFirst({
    where: { id: technicianId, organizationId: membership.organizationId, isActive: true },
    select: { id: true },
  });
  if (!technician) {
    throw new ApiError("TECHNICIAN_NOT_FOUND", 404, "Active technician not found.");
  }
  const assignment = await prisma.maintenanceAssignment.upsert({
    where: { maintenanceRequestId_technicianId: { maintenanceRequestId: requestId, technicianId } },
    create: { maintenanceRequestId: requestId, technicianId },
    update: { status: "ASSIGNED", completedAt: null },
    include: {
      technician: { select: { id: true, fullName: true, email: true, specialties: true } },
    },
  });
  return res.status(201).json({ success: true, data: { assignment } });
}

export async function unassignTechnician(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWriteRequest(membership.role);
  const requestId = requireUuid(req.params.requestId, "requestId");
  const assignmentId = requireUuid(req.params.assignmentId, "assignmentId");
  const request = await prisma.maintenanceRequest.findFirst({
    where: { id: requestId, organizationId: membership.organizationId },
    select: { id: true },
  });
  if (!request) {
    throw new ApiError("MAINTENANCE_NOT_FOUND", 404, "Maintenance request not found.");
  }
  const assignment = await prisma.maintenanceAssignment.findFirst({
    where: { id: assignmentId, maintenanceRequestId: requestId },
    select: { id: true },
  });
  if (!assignment) {
    throw new ApiError("ASSIGNMENT_NOT_FOUND", 404, "Technician assignment not found.");
  }
  await prisma.maintenanceAssignment.update({
    where: { id: assignmentId },
    data: { status: "CANCELLED" },
  });
  return res.json({ success: true, data: { removed: true } });
}

export async function createTechnician(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanManageTechnicians(membership.role);
  const body = requireObject(req.body);
  const email = optionalString(body.email, "email", 320);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new ApiError("VALIDATION_ERROR", 400, "email must be a valid email address.");
  }
  const phone = optionalString(body.phone, "phone", 40);
  if (
    email &&
    (await prisma.technician.findFirst({
      where: { organizationId: membership.organizationId, email },
      select: { id: true },
    }))
  ) {
    throw new ApiError(
      "TECHNICIAN_EMAIL_EXISTS",
      409,
      "A technician with this email already exists in the workspace.",
    );
  }
  let specialties = [];
  if (body.specialties !== undefined) {
    if (
      !Array.isArray(body.specialties) ||
      body.specialties.length > 20 ||
      body.specialties.some((item) => typeof item !== "string" || !item.trim() || item.length > 80)
    ) {
      throw new ApiError("VALIDATION_ERROR", 400, "specialties must be a list of up to 20 short labels.");
    }
    specialties = [...new Set(body.specialties.map((item) => item.trim()))];
  }
  const technician = await prisma.technician.create({
    data: {
      organizationId: membership.organizationId,
      fullName: requireString(body.fullName, "fullName", 160),
      email,
      phone,
      specialties,
    },
  });
  return res.status(201).json({ success: true, data: { technician } });
}

function parseOptionalDate(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) {
    throw new ApiError("VALIDATION_ERROR", 400, `${fieldName} must be a valid date.`);
  }
  return new Date(value);
}

function normalizeFileName(fileName) {
  return fileName.replace(/[\\/]/gu, "_").slice(0, 255);
}

function serializeMaintenanceRequest(request) {
  return {
    ...request,
    documents: request.documents.map(serializeMaintenanceDocument),
  };
}

function serializeMaintenanceDocument(document) {
  return {
    ...document,
    sizeBytes:
      document.sizeBytes === null || document.sizeBytes === undefined
        ? document.sizeBytes
        : document.sizeBytes.toString(),
  };
}

function ensureCanWriteRequest(role) {
  if (!REQUEST_WRITERS.includes(role)) {
    throw new ApiError("INSUFFICIENT_PERMISSIONS", 403, "You do not have permission to change maintenance requests.");
  }
}

function ensureCanManageTechnicians(role) {
  if (!MANAGERS.includes(role)) {
    throw new ApiError("INSUFFICIENT_PERMISSIONS", 403, "You do not have permission to manage technicians.");
  }
}
