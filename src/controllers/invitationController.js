import { createHash, randomBytes } from "node:crypto";
import prisma from "../config/prismaClient.js";
import { ApiError } from "../services/apiError.js";
import { requireOrganizationMembership, requireUuid } from "../services/organizationAccess.js";
import { requireEnum, requireObject, requireString } from "../services/requestValidation.js";

const INVITERS = ["OWNER", "ADMIN"];
const INVITABLE_ROLES = [
  "ADMIN",
  "PROPERTY_MANAGER",
  "ACCOUNTANT",
  "MAINTENANCE",
  "VIEWER",
];
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export async function createInvitations(req, res) {
  const organizationId = requireUuid(req.params.organizationId, "organizationId");
  await requireOrganizationMembership(organizationId, req.authUserId, INVITERS);
  const body = requireObject(req.body);
  const rawInvitations = Array.isArray(body.invitations)
    ? body.invitations
    : [{ email: body.email, role: body.role }];
  if (rawInvitations.length === 0 || rawInvitations.length > 20) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "Provide between 1 and 20 invitations.",
    );
  }

  const invitations = rawInvitations.map((item) => {
    const invitation = requireObject(item);
    const email = requireString(invitation.email, "email", 320).toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      throw new ApiError("VALIDATION_ERROR", 400, "Enter a valid email address.");
    }
    return {
      email,
      role: requireEnum(invitation.role, INVITABLE_ROLES, "role"),
    };
  });
  if (new Set(invitations.map(({ email }) => email)).size !== invitations.length) {
    throw new ApiError("VALIDATION_ERROR", 400, "Each invitee email must be unique.");
  }

  await Promise.all(
    invitations.map(async ({ email, role }) => {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (user) {
        const membership = await prisma.membership.findUnique({
          where: { organizationId_userId: { organizationId, userId: user.id } },
          select: { status: true },
        });
        if (membership?.status === "ACTIVE") {
          throw new ApiError(
            "ALREADY_A_MEMBER",
            409,
            `${email} is already an active workspace member.`,
          );
        }
      }

      const pending = await prisma.invitation.findFirst({
        where: { organizationId, email, status: "PENDING", expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (pending) {
        throw new ApiError(
          "INVITATION_ALREADY_PENDING",
          409,
          `An invitation for ${email} is already pending.`,
        );
      }
    }),
  );
  const prepared = invitations.map(({ email, role }) => ({
    email,
    role,
    token: randomBytes(32).toString("base64url"),
    expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
  }));
  const created = await prisma.$transaction(
    prepared.map(({ email, role, token, expiresAt }) =>
      prisma.invitation.create({
        data: {
          organizationId,
          email,
          role,
          tokenHash: hashToken(token),
          invitedByUserId: req.authUserId,
          expiresAt,
        },
        select: {
          id: true,
          email: true,
          role: true,
          expiresAt: true,
          status: true,
        },
      }),
    ),
  );
  const inviteRecords = created.map((invitation, index) => ({
    ...invitation,
    token: prepared[index].token,
  }));

  return res.status(201).json({
    success: true,
    data: {
      invitations: inviteRecords,
      delivery: "No email provider is configured; deliver these one-time tokens securely.",
    },
  });
}

export async function listInvitations(req, res) {
  const organizationId = requireUuid(req.params.organizationId, "organizationId");
  await requireOrganizationMembership(organizationId, req.authUserId);
  const now = new Date();
  const invitations = await prisma.invitation.findMany({
    where: {
      organizationId,
      OR: [
        { status: "ACCEPTED" },
        { status: "PENDING", expiresAt: { gt: now } },
      ],
    },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      acceptedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ success: true, data: { invitations } });
}

export async function cancelInvitation(req, res) {
  const organizationId = requireUuid(req.params.organizationId, "organizationId");
  const invitationId = requireUuid(req.params.invitationId, "invitationId");
  await requireOrganizationMembership(organizationId, req.authUserId, INVITERS);
  const result = await prisma.invitation.updateMany({
    where: {
      id: invitationId,
      organizationId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    data: { status: "CANCELED" },
  });
  if (result.count === 0) {
    throw new ApiError(
      "INVITATION_NOT_FOUND",
      404,
      "Pending invitation not found.",
    );
  }
  return res.json({ success: true, data: { canceled: true } });
}

export async function acceptInvitation(req, res) {
  const body = requireObject(req.body);
  const token = requireString(body.token, "token", 128);
  const user = await prisma.user.findUnique({
    where: { id: req.authUserId },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new ApiError("INVALID_SESSION", 401, "Please sign in again.");
  }

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!invitation || invitation.status !== "PENDING") {
    throw new ApiError(
      "INVITATION_INVALID",
      400,
      "This invitation is invalid, expired, or has already been used.",
    );
  }
  if (invitation.expiresAt <= new Date()) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "EXPIRED" },
    });
    throw new ApiError("INVITATION_EXPIRED", 410, "This invitation has expired.");
  }
  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    throw new ApiError(
      "INVITATION_EMAIL_MISMATCH",
      403,
      "Sign in with the email address this invitation was sent to.",
    );
  }

  const membership = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.invitation.updateMany({
      where: {
        id: invitation.id,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
        acceptedByUserId: user.id,
      },
    });
    if (claimed.count !== 1) {
      throw new ApiError(
        "INVITATION_INVALID",
        409,
        "This invitation has already been used or expired.",
      );
    }

    const existingMembership = await transaction.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: invitation.organizationId,
          userId: user.id,
        },
      },
      select: { status: true },
    });
    if (existingMembership?.status === "ACTIVE") {
      throw new ApiError(
        "ALREADY_A_MEMBER",
        409,
        "You are already an active member of this workspace.",
      );
    }

    return transaction.membership.upsert({
      where: {
        organizationId_userId: {
          organizationId: invitation.organizationId,
          userId: user.id,
        },
      },
      create: {
        organizationId: invitation.organizationId,
        userId: user.id,
        role: invitation.role,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
      update: {
        role: invitation.role,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });
  });
  return res.json({ success: true, data: { membership } });
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
