import { randomBytes } from "node:crypto";
import prisma from "../config/prismaClient.js";
import { ApiError } from "../services/apiError.js";
import {
  getCurrentMembership,
  requireOrganizationMembership,
  requireUuid,
} from "../services/organizationAccess.js";
import {
  requireObject,
  requireString,
} from "../services/requestValidation.js";

const ORGANIZATION_EDITORS = ["OWNER", "ADMIN"];

export async function createOrganization(req, res) {
  const body = requireObject(req.body);
  const name = requireString(body.name, "name", 160);
  const countryCode = requireString(body.countryCode, "countryCode", 2).toUpperCase();
  const timezone = requireString(body.timezone, "timezone", 100);

  if (!/^[A-Z]{2}$/u.test(countryCode)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "countryCode must be a two-letter ISO country code.",
    );
  }
  validateTimezone(timezone);

  const baseSlug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 80) || "workspace";
  const slug = `${baseSlug}-${randomBytes(4).toString("hex")}`;

  const organization = await prisma.$transaction(async (transaction) => {
    const created = await transaction.organization.create({
      data: { name, countryCode, timezone, slug },
    });
    await transaction.membership.create({
      data: {
        organizationId: created.id,
        userId: req.authUserId,
        role: "OWNER",
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });
    return created;
  });

  return res.status(201).json({
    success: true,
    data: { organization, role: "OWNER" },
  });
}

export async function getCurrentOrganization(req, res) {
  const membership = await getCurrentMembership(req.authUserId);
  if (!membership) {
    throw new ApiError("WORKSPACE_NOT_FOUND", 404, "No workspace is set up yet.");
  }

  return res.json({
    success: true,
    data: { organization: membership.organization, role: membership.role },
  });
}

export async function updateOrganization(req, res) {
  const organizationId = requireUuid(req.params.organizationId, "organizationId");
  await requireOrganizationMembership(
    organizationId,
    req.authUserId,
    ORGANIZATION_EDITORS,
  );
  const body = requireObject(req.body);
  const data = {};

  if (body.name !== undefined) {
    data.name = requireString(body.name, "name", 160);
  }
  if (body.countryCode !== undefined) {
    const countryCode = requireString(body.countryCode, "countryCode", 2).toUpperCase();
    if (!/^[A-Z]{2}$/u.test(countryCode)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "countryCode must be a two-letter ISO country code.",
      );
    }
    data.countryCode = countryCode;
  }
  if (body.timezone !== undefined) {
    data.timezone = requireString(body.timezone, "timezone", 100);
    validateTimezone(data.timezone);
  }
  if (Object.keys(data).length === 0) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "At least one organization field must be provided.",
    );
  }

  const organization = await prisma.organization.update({
    where: { id: organizationId },
    data,
  });
  return res.json({ success: true, data: { organization } });
}

function validateTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new ApiError("VALIDATION_ERROR", 400, "timezone must be a valid IANA timezone.");
  }
}
