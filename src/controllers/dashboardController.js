import prisma from "../config/prismaClient.js";
import { requireCurrentMembership } from "../services/organizationAccess.js";

export async function getDashboardOverview(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const organizationId = membership.organizationId;
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1),
  );
  const nextMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const [
    propertyCount,
    unitCount,
    occupiedUnitCount,
    activeLeaseCount,
    openMaintenanceCount,
    collectedPayments,
    paymentTrend,
    properties,
  ] = await Promise.all([
    prisma.property.count({ where: { organizationId } }),
    prisma.unit.count({ where: { property: { organizationId } } }),
    prisma.unit.count({
      where: { property: { organizationId }, status: "OCCUPIED" },
    }),
    prisma.lease.count({ where: { organizationId, status: "ACTIVE" } }),
    prisma.maintenanceRequest.count({
      where: {
        organizationId,
        status: { in: ["OPEN", "IN_PROGRESS", "ON_HOLD"] },
      },
    }),
    prisma.payment.groupBy({
      by: ["currency"],
      where: { organizationId, status: "SUCCEEDED" },
      _sum: { amount: true },
    }),
    prisma.$queryRaw`
      SELECT
        to_char(date_trunc('month', "paid_at" AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
        currency,
        SUM(amount) AS amount
      FROM payments
      WHERE organization_id = ${organizationId}::uuid
        AND status = 'SUCCEEDED'
        AND paid_at >= ${monthStart}
        AND paid_at < ${nextMonthStart}
      GROUP BY date_trunc('month', "paid_at" AT TIME ZONE 'UTC'), currency
      ORDER BY date_trunc('month', "paid_at" AT TIME ZONE 'UTC'), currency
    `,
    prisma.property.findMany({
      where: { organizationId },
      include: { _count: { select: { units: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const tasks = [
    { id: "setup-method", title: "Choose how to set up your portfolio", completed: Boolean(membership.organization.setupMethod) },
    { id: "property", title: "Add your first property", completed: propertyCount > 0 },
    { id: "team", title: "Invite your team or skip this step", completed: Boolean(membership.organization.teamStepCompletedAt) },
  ].filter((task) => !task.completed);

  return res.json({
    success: true,
    data: {
      workspace: membership.organization,
      properties,
      tasks,
      metrics: {
        properties: propertyCount,
        units: unitCount,
        occupiedUnits: occupiedUnitCount,
        occupancyRate: unitCount === 0 ? 0 : occupiedUnitCount / unitCount,
        activeLeases: activeLeaseCount,
        openMaintenance: openMaintenanceCount,
        collectedPayments: collectedPayments.map((payment) => ({
          currency: payment.currency,
          amount: payment._sum.amount ?? 0,
        })),
        paymentTrend,
      },
    },
  });
}

export async function getGettingStarted(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const organization = membership.organization;
  const propertyCount = await prisma.property.count({
    where: { organizationId: organization.id },
  });
  const tasks = [
    {
      id: "workspace",
      title: "Create your workspace",
      completed: true,
    },
    {
      id: "setup-method",
      title: "Choose how to set up your portfolio",
      completed: Boolean(organization.setupMethod),
    },
    {
      id: "property",
      title: "Add your first property",
      completed: propertyCount > 0,
    },
    {
      id: "team",
      title: "Invite your team or skip this step",
      completed: Boolean(organization.teamStepCompletedAt),
    },
  ];

  return res.json({
    success: true,
    data: { tasks: tasks.filter((task) => !task.completed) },
  });
}
