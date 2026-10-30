import prisma from "../config/prismaClient.js";
import { ApiError } from "./apiError.js";

export async function getCurrentMembership(userId) {
  return prisma.membership.findFirst({
    where: { userId, status: "ACTIVE" },
    include: { organization: true },
    orderBy: [{ joinedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function requireCurrentMembership(userId) {
  const membership = await getCurrentMembership(userId);
  if (!membership) {
    throw new ApiError(
      "WORKSPACE_NOT_FOUND",
      404,
      "Create a workspace before continuing.",
    );
  }
  return membership;
}

export async function requireOrganizationMembership(
  organizationId,
  userId,
  allowedRoles,
) {
  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });

  if (!membership || membership.status !== "ACTIVE") {
    throw new ApiError("WORKSPACE_NOT_FOUND", 404, "Workspace not found.");
  }

  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw new ApiError(
      "INSUFFICIENT_PERMISSIONS",
      403,
      "You do not have permission to make this change.",
    );
  }

  return membership;
}

export function requireUuid(value, fieldName) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  ) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      `${fieldName} must be a valid identifier.`,
    );
  }
  return value;
}
