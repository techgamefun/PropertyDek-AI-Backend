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

const PROPERTY_WRITERS = ["OWNER", "ADMIN", "PROPERTY_MANAGER"];
const PROPERTY_TYPES = ["APARTMENT", "HOUSE", "CONDO", "COMMERCIAL", "OTHER"];
const UNIT_STATUSES = ["AVAILABLE", "OCCUPIED", "RESERVED", "MAINTENANCE", "INACTIVE"];
const PROPERTY_DOCUMENT_SELECT = {
  id: true,
  name: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedBy: { select: { id: true, fullName: true } },
};

function normalizeFileName(fileName) {
  return fileName.replace(/[\\/]/gu, "_").slice(0, 255);
}

function serializePropertyDocument(document) {
  return {
    ...document,
    sizeBytes:
      document.sizeBytes === null || document.sizeBytes === undefined
        ? document.sizeBytes
        : document.sizeBytes.toString(),
  };
}

export async function createProperty(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const body = requireObject(req.body);
  const organization = membership.organization;
  const data = {
    organizationId: organization.id,
    name: requireString(body.name, "name", 160),
    type:
      body.type === undefined
        ? "OTHER"
        : requireEnum(body.type, PROPERTY_TYPES, "type"),
    addressLine1: requireString(body.addressLine1, "addressLine1", 200),
    addressLine2: optionalString(body.addressLine2, "addressLine2", 200),
    city: requireString(body.city, "city", 100),
    region: optionalString(body.region, "region", 100),
    postalCode: optionalString(body.postalCode, "postalCode", 30),
    countryCode:
      body.countryCode === undefined
        ? organization.countryCode
        : requireString(body.countryCode, "countryCode", 2).toUpperCase(),
    timezone:
      body.timezone === undefined
        ? organization.timezone
        : optionalString(body.timezone, "timezone", 100),
    description: optionalString(body.description, "description", 10000),
  };
  if (!data.countryCode || !/^[A-Z]{2}$/u.test(data.countryCode)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "countryCode must be a two-letter ISO country code.",
    );
  }

  const property = await prisma.property.create({
    data,
    include: { units: true },
  });
  return res.status(201).json({ success: true, data: { property } });
}

export async function listProperties(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const properties = await prisma.property.findMany({
    where: { organizationId: membership.organizationId },
    include: { _count: { select: { units: true } } },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ success: true, data: { properties } });
}

export async function getProperty(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const propertyId = requireUuid(req.params.propertyId, "propertyId");
  const property = await prisma.property.findFirst({
    where: {
      id: propertyId,
      organizationId: membership.organizationId,
    },
    include: {
      units: { orderBy: { unitNumber: "asc" } },
      documents: {
        select: PROPERTY_DOCUMENT_SELECT,
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!property) {
    throw new ApiError("PROPERTY_NOT_FOUND", 404, "Property not found.");
  }
  return res.json({
    success: true,
    data: {
      property: {
        ...property,
        documents: property.documents.map(serializePropertyDocument),
      },
    },
  });
}

export async function uploadPropertyDocument(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const propertyId = requireUuid(req.params.propertyId, "propertyId");
  if (!req.file) {
    throw new ApiError("DOCUMENT_REQUIRED", 400, "Choose a document to upload.");
  }
  const fileExtension = extname(req.file.originalname).slice(1).toLowerCase();
  const allowedExtensionsByMimeType = {
    "application/pdf": ["pdf"],
    "application/msword": ["doc"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
      "docx",
    ],
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
  };
  if (
    !/^[a-z0-9]{1,10}$/u.test(fileExtension) ||
    !/^[\w.+-]+\/[\w.+-]+$/u.test(req.file.mimetype) ||
    (allowedExtensionsByMimeType[req.file.mimetype] &&
      !allowedExtensionsByMimeType[req.file.mimetype].includes(fileExtension))
  ) {
    throw new ApiError(
      "INVALID_DOCUMENT_TYPE",
      400,
      "The document filename extension must match its file type.",
    );
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId: membership.organizationId },
    select: { id: true },
  });
  if (!property) {
    throw new ApiError("PROPERTY_NOT_FOUND", 404, "Property not found.");
  }

  const uploaded = await uploadPrivateDocument(req.file.buffer, req.file.originalname);
  try {
    const document = await prisma.document.create({
      data: {
        organizationId: membership.organizationId,
        uploadedById: req.authUserId,
        propertyId,
        name: normalizeFileName(req.file.originalname),
        storagePath: uploaded.public_id,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
      },
      select: PROPERTY_DOCUMENT_SELECT,
    });
    return res.status(201).json({
      success: true,
      data: { document: serializePropertyDocument(document) },
    });
  } catch (error) {
    try {
      await deletePrivateDocument(uploaded.public_id);
    } catch (cleanupError) {
      console.error("Failed to remove an unrecorded property document:", cleanupError);
    }
    throw error;
  }
}

export async function downloadPropertyDocument(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const propertyId = requireUuid(req.params.propertyId, "propertyId");
  const documentId = requireUuid(req.params.documentId, "documentId");
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      propertyId,
      organizationId: membership.organizationId,
    },
    select: { storagePath: true, name: true },
  });
  if (!document) {
    throw new ApiError("DOCUMENT_NOT_FOUND", 404, "Property document not found.");
  }
  const downloadUrl = getPrivateDocumentDownloadUrl(
    document.storagePath,
    extname(document.name).slice(1).toLowerCase(),
  );
  return res.json({ success: true, data: { downloadUrl } });
}

export async function deletePropertyDocument(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const propertyId = requireUuid(req.params.propertyId, "propertyId");
  const documentId = requireUuid(req.params.documentId, "documentId");
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      propertyId,
      organizationId: membership.organizationId,
    },
    select: { id: true, storagePath: true },
  });
  if (!document) {
    throw new ApiError("DOCUMENT_NOT_FOUND", 404, "Property document not found.");
  }
  await deletePrivateDocument(document.storagePath);
  await prisma.document.delete({ where: { id: document.id } });
  return res.json({ success: true, data: { deleted: true } });
}

export async function updateProperty(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const propertyId = requireUuid(req.params.propertyId, "propertyId");
  await getScopedProperty(propertyId, membership.organizationId);
  const body = requireObject(req.body);
  const data = {};
  const stringFields = {
    name: 160,
    addressLine1: 200,
    addressLine2: 200,
    city: 100,
    region: 100,
    postalCode: 30,
    timezone: 100,
    description: 10000,
  };

  for (const [field, maxLength] of Object.entries(stringFields)) {
    if (body[field] !== undefined) {
      data[field] = optionalString(body[field], field, maxLength);
      if (data[field] === null && ["name", "addressLine1", "city"].includes(field)) {
        throw new ApiError("VALIDATION_ERROR", 400, `${field} cannot be empty.`);
      }
    }
  }
  if (body.type !== undefined) {
    data.type = requireEnum(body.type, PROPERTY_TYPES, "type");
  }
  if (body.countryCode !== undefined) {
    data.countryCode = requireString(body.countryCode, "countryCode", 2).toUpperCase();
    if (!/^[A-Z]{2}$/u.test(data.countryCode)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "countryCode must be a two-letter ISO country code.",
      );
    }
  }
  if (Object.keys(data).length === 0) {
    throw new ApiError("VALIDATION_ERROR", 400, "At least one property field is required.");
  }

  const property = await prisma.property.update({
    where: { id: propertyId },
    data,
    include: { units: true },
  });
  return res.json({ success: true, data: { property } });
}

export async function createUnit(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const propertyId = requireUuid(req.params.propertyId, "propertyId");
  await getScopedProperty(propertyId, membership.organizationId);
  const unit = await prisma.unit.create({
    data: mapUnit(requireObject(req.body), propertyId),
  });
  return res.status(201).json({ success: true, data: { unit } });
}

export async function createUnitsBulk(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const propertyId = requireUuid(req.params.propertyId, "propertyId");
  await getScopedProperty(propertyId, membership.organizationId);
  const body = requireObject(req.body);
  if (!Array.isArray(body.units) || body.units.length === 0 || body.units.length > 100) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "units must contain between 1 and 100 unit records.",
    );
  }
  const unitData = body.units.map((unit) => mapUnit(unit, propertyId));
  const units = await prisma.$transaction(
    unitData.map((data) => prisma.unit.create({ data })),
  );
  return res.status(201).json({
    success: true,
    data: { units, count: units.length },
  });
}

export async function listUnits(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const propertyId = requireUuid(req.params.propertyId, "propertyId");
  await getScopedProperty(propertyId, membership.organizationId);
  const units = await prisma.unit.findMany({
    where: { propertyId },
    orderBy: { unitNumber: "asc" },
  });
  return res.json({ success: true, data: { units } });
}

function mapUnit(body, propertyId) {
  const unit = requireObject(body);
  const data = {
    propertyId,
    unitNumber: requireString(unit.unitNumber, "unitNumber", 40),
    monthlyRent: requireNumber(unit.monthlyRent, "monthlyRent", { max: 9999999999.99 }),
    status:
      unit.status === undefined
        ? "AVAILABLE"
        : requireEnum(unit.status, UNIT_STATUSES, "status"),
  };
  for (const [field, max] of [
    ["bedrooms", 999.9],
    ["bathrooms", 999.9],
    ["floor", 1000],
    ["squareFeet", 10000000],
  ]) {
    if (unit[field] !== undefined && unit[field] !== null && unit[field] !== "") {
      data[field] = requireNumber(unit[field], field, { max });
      if (["floor", "squareFeet"].includes(field) && !Number.isInteger(data[field])) {
        throw new ApiError("VALIDATION_ERROR", 400, `${field} must be a whole number.`);
      }
    }
  }
  if (unit.description !== undefined) {
    data.description = optionalString(unit.description, "description", 10000);
  }
  return data;
}

async function getScopedProperty(propertyId, organizationId) {
  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId },
    select: { id: true },
  });
  if (!property) {
    throw new ApiError("PROPERTY_NOT_FOUND", 404, "Property not found.");
  }
  return property;
}

function ensureCanWrite(role) {
  if (!PROPERTY_WRITERS.includes(role)) {
    throw new ApiError(
      "INSUFFICIENT_PERMISSIONS",
      403,
      "You do not have permission to change properties.",
    );
  }
}
