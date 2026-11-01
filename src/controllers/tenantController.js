import prisma from "../config/prismaClient.js";
import { ApiError } from "../services/apiError.js";
import {
  requireCurrentMembership,
  requireUuid,
} from "../services/organizationAccess.js";
import {
  optionalString,
  requireObject,
  requireString,
} from "../services/requestValidation.js";

const TENANT_WRITERS = ["OWNER", "ADMIN", "PROPERTY_MANAGER"];
const TENANT_FIELDS = {
  email: 320,
  phone: 40,
  emergencyContact: 160,
  emergencyPhone: 40,
  notes: 10000,
};

export async function listTenants(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const where = { organizationId: membership.organizationId };
  if (req.query.search !== undefined) {
    const search = requireString(req.query.search, "search", 160);
    where.OR = [
      { fullName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
    ];
  }
  const tenants = await prisma.tenant.findMany({
    where,
    include: { _count: { select: { leases: true, maintenanceRequests: true } } },
    orderBy: [{ fullName: "asc" }, { createdAt: "desc" }],
  });
  return res.json({ success: true, data: { tenants } });
}

export async function getTenant(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const tenantId = requireUuid(req.params.tenantId, "tenantId");
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, organizationId: membership.organizationId },
    include: {
      leases: {
        where: { organizationId: membership.organizationId },
        include: {
          unit: {
            select: {
              id: true,
              unitNumber: true,
              property: { select: { id: true, name: true, addressLine1: true, city: true } },
            },
          },
        },
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      },
      maintenanceRequests: {
        where: { organizationId: membership.organizationId },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          requestedAt: true,
          property: { select: { id: true, name: true } },
          unit: { select: { id: true, unitNumber: true } },
        },
        orderBy: { requestedAt: "desc" },
      },
    },
  });
  if (!tenant) {
    throw new ApiError("TENANT_NOT_FOUND", 404, "Tenant not found.");
  }
  return res.json({ success: true, data: { tenant } });
}

export async function createTenant(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const body = requireObject(req.body);
  const data = {
    organizationId: membership.organizationId,
    fullName: requireString(body.fullName, "fullName", 160),
    ...mapTenantFields(body),
  };
  validateEmail(data.email);
  const tenant = await prisma.tenant.create({ data });
  return res.status(201).json({ success: true, data: { tenant } });
}

export async function updateTenant(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const tenantId = requireUuid(req.params.tenantId, "tenantId");
  const body = requireObject(req.body);
  const data = {};
  if (body.fullName !== undefined) {
    data.fullName = requireString(body.fullName, "fullName", 160);
  }
  Object.assign(data, mapTenantFields(body));
  if (Object.keys(data).length === 0) {
    throw new ApiError("VALIDATION_ERROR", 400, "At least one tenant field is required.");
  }
  validateEmail(data.email);

  await requireScopedTenant(tenantId, membership.organizationId);
  const tenant = await prisma.tenant.update({ where: { id: tenantId }, data });
  return res.json({ success: true, data: { tenant } });
}

export async function deleteTenant(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const tenantId = requireUuid(req.params.tenantId, "tenantId");

  try {
    await prisma.$transaction(async (transaction) => {
      const tenant = await transaction.tenant.findFirst({
        where: { id: tenantId, organizationId: membership.organizationId },
        select: { id: true, _count: { select: { leases: true } } },
      });
      if (!tenant) {
        throw new ApiError("TENANT_NOT_FOUND", 404, "Tenant not found.");
      }
      if (tenant._count.leases > 0) {
        throw new ApiError(
          "TENANT_HAS_LEASES",
          409,
          "Tenants with lease history cannot be deleted.",
        );
      }
      await transaction.tenant.delete({ where: { id: tenantId } });
    });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "P2003") {
      throw new ApiError(
        "TENANT_HAS_LEASES",
        409,
        "Tenants with lease history cannot be deleted.",
      );
    }
    throw error;
  }

  return res.json({ success: true, data: { deleted: true } });
}

function mapTenantFields(body) {
  const data = {};
  for (const [field, maxLength] of Object.entries(TENANT_FIELDS)) {
    if (body[field] !== undefined) {
      data[field] = optionalString(body[field], field, maxLength);
    }
  }
  if (data.email !== undefined && data.email !== null) {
    data.email = data.email.toLowerCase();
  }
  return data;
}

function validateEmail(email) {
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new ApiError("VALIDATION_ERROR", 400, "email must be a valid email address.");
  }
}

async function requireScopedTenant(tenantId, organizationId) {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, organizationId },
    select: { id: true },
  });
  if (!tenant) {
    throw new ApiError("TENANT_NOT_FOUND", 404, "Tenant not found.");
  }
  return tenant;
}

function ensureCanWrite(role) {
  if (!TENANT_WRITERS.includes(role)) {
    throw new ApiError(
      "INSUFFICIENT_PERMISSIONS",
      403,
      "You do not have permission to change tenants.",
    );
  }
}
