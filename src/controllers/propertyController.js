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

const PROPERTY_WRITERS = ["OWNER", "ADMIN", "PROPERTY_MANAGER"];
const PROPERTY_TYPES = ["APARTMENT", "HOUSE", "CONDO", "COMMERCIAL", "OTHER"];
const UNIT_STATUSES = ["AVAILABLE", "OCCUPIED", "RESERVED", "MAINTENANCE", "INACTIVE"];

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
    include: { units: { orderBy: { unitNumber: "asc" } } },
  });
  if (!property) {
    throw new ApiError("PROPERTY_NOT_FOUND", 404, "Property not found.");
  }
  return res.json({ success: true, data: { property } });
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
