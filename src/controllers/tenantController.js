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
import {
  deleteImage,
  getCloudinaryImagePublicId,
  uploadImage,
} from "../services/cloudinaryService.js";

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
  const uploadedAvatar = req.file ? await uploadImage(req.file.buffer) : null;
  if (uploadedAvatar) {
    data.avatarUrl = uploadedAvatar.secure_url;
  }

  let tenant;
  try {
    tenant = await prisma.tenant.create({ data });
  } catch (error) {
    await removeUploadedAvatar(uploadedAvatar);
    throw error;
  }
  return res.status(201).json({ success: true, data: { tenant } });
}

export async function updateTenant(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const tenantId = requireUuid(req.params.tenantId, "tenantId");
  const body = requireObject(req.body);
  const removeAvatar = body.removeAvatar === true;
  if (body.removeAvatar !== undefined && !removeAvatar) {
    throw new ApiError("VALIDATION_ERROR", 400, "removeAvatar must be true when provided.");
  }
  const data = {};
  if (body.fullName !== undefined) {
    data.fullName = requireString(body.fullName, "fullName", 160);
  }
  Object.assign(data, mapTenantFields(body));
  if (removeAvatar && !req.file) {
    data.avatarUrl = null;
  }
  if (Object.keys(data).length === 0 && !req.file) {
    throw new ApiError("VALIDATION_ERROR", 400, "At least one tenant field is required.");
  }
  if (req.file && removeAvatar) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "Choose a new photo or remove the current photo, not both.",
    );
  }
  validateEmail(data.email);

  const existingTenant = await requireScopedTenant(tenantId, membership.organizationId);
  const uploadedAvatar = req.file ? await uploadImage(req.file.buffer) : null;
  if (uploadedAvatar) {
    data.avatarUrl = uploadedAvatar.secure_url;
  }

  let tenant;
  try {
    tenant = await prisma.tenant.update({ where: { id: tenantId }, data });
  } catch (error) {
    await removeUploadedAvatar(uploadedAvatar);
    throw error;
  }
  if (uploadedAvatar || removeAvatar) {
    await removePreviousAvatar(existingTenant.avatarUrl);
  }
  return res.json({ success: true, data: { tenant } });
}

export async function deleteTenant(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  ensureCanWrite(membership.role);
  const tenantId = requireUuid(req.params.tenantId, "tenantId");
  let avatarUrl;

  try {
    await prisma.$transaction(async (transaction) => {
      const tenant = await transaction.tenant.findFirst({
        where: { id: tenantId, organizationId: membership.organizationId },
        select: { id: true, avatarUrl: true, _count: { select: { leases: true } } },
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
      avatarUrl = tenant.avatarUrl;
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

  await removePreviousAvatar(avatarUrl);
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
    select: { id: true, avatarUrl: true },
  });
  if (!tenant) {
    throw new ApiError("TENANT_NOT_FOUND", 404, "Tenant not found.");
  }
  return tenant;
}

async function removeUploadedAvatar(avatar) {
  if (!avatar?.public_id) {
    return;
  }
  try {
    await deleteImage(avatar.public_id);
  } catch (error) {
    console.error("Failed to remove an unused Cloudinary tenant photo:", error);
  }
}

async function removePreviousAvatar(avatarUrl) {
  const publicId = getCloudinaryImagePublicId(avatarUrl);
  if (!publicId) {
    return;
  }
  try {
    await deleteImage(publicId);
  } catch (error) {
    console.error("Failed to remove an unused Cloudinary tenant photo:", error);
  }
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
