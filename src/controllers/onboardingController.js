import prisma from "../config/prismaClient.js";
import { ApiError } from "../services/apiError.js";
import {
  getCurrentMembership,
  requireCurrentMembership,
} from "../services/organizationAccess.js";
import {
  requireEnum,
  requireObject,
} from "../services/requestValidation.js";

const SETUP_METHODS = ["FRESH", "IMPORT", "DEMO"];

export async function getOnboardingStatus(req, res) {
  const membership = await getCurrentMembership(req.authUserId);
  if (!membership) {
    return res.json({
      success: true,
      data: {
        organization: null,
        currentStep: "workspace",
        completed: false,
        steps: {
          workspace: false,
          setupMethod: false,
          property: false,
          team: false,
        },
      },
    });
  }

  const organization = membership.organization;
  const propertyCount = await prisma.property.count({
    where: { organizationId: organization.id },
  });
  const steps = {
    workspace: true,
    setupMethod: Boolean(organization.setupMethod),
    property: propertyCount > 0,
    team: Boolean(organization.teamStepCompletedAt),
  };
  const currentStep = organization.onboardingCompleted
    ? "complete"
    : !steps.setupMethod
      ? "setup"
      : !steps.property
        ? "property"
        : !steps.team
          ? "team"
          : "complete";

  return res.json({
    success: true,
    data: {
      organization,
      currentStep,
      completed: organization.onboardingCompleted,
      steps,
    },
  });
}

export async function saveSetupMethod(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const body = requireObject(req.body);
  const method = requireEnum(
    typeof body.method === "string" ? body.method.toUpperCase() : body.method,
    SETUP_METHODS,
    "method",
  );
  const organization = await prisma.organization.update({
    where: { id: membership.organizationId },
    data: { setupMethod: method, onboardingCompleted: false },
  });

  return res.json({ success: true, data: { organization } });
}

export async function createDemoData(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const organization = membership.organization;
  if (organization.setupMethod !== "DEMO") {
    throw new ApiError(
      "INVALID_ONBOARDING_STEP",
      409,
      "Choose the demo setup method before creating sample data.",
    );
  }

  const demo = await prisma.$transaction(async (transaction) => {
    const reservation = await transaction.organization.updateMany({
      where: {
        id: organization.id,
        demoDataCreatedAt: null,
      },
      data: { demoDataCreatedAt: new Date() },
    });

    if (reservation.count === 0) {
      return {
        property: await transaction.property.findFirst({
          where: { organizationId: organization.id, name: "Sample Property" },
          include: { units: true },
        }),
        created: false,
      };
    }

    const sampleProperty = await transaction.property.create({
      data: {
        organizationId: organization.id,
        name: "Sample Property",
        type: "APARTMENT",
        addressLine1: "100 Example Avenue",
        city: "Sample City",
        region: "CA",
        postalCode: "90001",
        countryCode: organization.countryCode ?? "US",
        timezone: organization.timezone,
      },
    });
    const unit = await transaction.unit.create({
      data: {
        propertyId: sampleProperty.id,
        unitNumber: "1A",
        bedrooms: 2,
        bathrooms: 1,
        monthlyRent: 1850,
        status: "OCCUPIED",
      },
    });
    const tenant = await transaction.tenant.create({
      data: {
        organizationId: organization.id,
        fullName: "Jordan Lee",
        email: "jordan@example.test",
        phone: "+1-555-0100",
      },
    });
    await transaction.lease.create({
      data: {
        organizationId: organization.id,
        unitId: unit.id,
        tenantId: tenant.id,
        status: "ACTIVE",
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2026-12-31T00:00:00.000Z"),
        monthlyRent: 1850,
        securityDeposit: 1850,
      },
    });
    await transaction.maintenanceRequest.create({
      data: {
        organizationId: organization.id,
        propertyId: sampleProperty.id,
        unitId: unit.id,
        tenantId: tenant.id,
        title: "Check kitchen faucet",
        description: "The kitchen faucet has a slow drip.",
        category: "Plumbing",
        priority: "LOW",
      },
    });

    return {
      property: await transaction.property.findUnique({
        where: { id: sampleProperty.id },
        include: { units: true },
      }),
      created: true,
    };
  });

  return res.status(201).json({
    success: true,
    data: demo,
  });
}

export async function completeTeamStep(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const body = requireObject(req.body);
  const action = requireEnum(body.action, ["completed", "skipped"], "action");
  const organization = await prisma.organization.update({
    where: { id: membership.organizationId },
    data: {
      teamStepCompletedAt: new Date(),
      teamStepSkipped: action === "skipped",
    },
  });
  return res.json({ success: true, data: { organization } });
}

export async function completeOnboarding(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const organization = membership.organization;
  const propertyCount = await prisma.property.count({
    where: { organizationId: organization.id },
  });
  if (!organization.setupMethod || propertyCount === 0) {
    throw new ApiError(
      "ONBOARDING_INCOMPLETE",
      409,
      "Choose a setup method and add at least one property before finishing onboarding.",
    );
  }
  if (!organization.teamStepCompletedAt) {
    throw new ApiError(
      "ONBOARDING_INCOMPLETE",
      409,
      "Complete or skip the team invitation step before finishing onboarding.",
    );
  }

  const updated = await prisma.organization.update({
    where: { id: organization.id },
    data: { onboardingCompleted: true },
  });
  return res.json({ success: true, data: { organization: updated } });
}
