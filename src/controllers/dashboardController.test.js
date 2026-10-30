import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentMembership: vi.fn(),
  propertyCount: vi.fn(),
  unitCount: vi.fn(),
  activeLeaseCount: vi.fn(),
  openMaintenanceCount: vi.fn(),
  collectedPayments: vi.fn(),
  paymentTrend: vi.fn(),
  properties: vi.fn(),
}));

vi.mock("../config/prismaClient.js", () => ({
  default: {
    property: {
      count: mocks.propertyCount,
      findMany: mocks.properties,
    },
    unit: { count: mocks.unitCount },
    lease: { count: mocks.activeLeaseCount },
    maintenanceRequest: { count: mocks.openMaintenanceCount },
    payment: { groupBy: mocks.collectedPayments },
    $queryRaw: mocks.paymentTrend,
  },
}));

vi.mock("../services/organizationAccess.js", () => ({
  requireCurrentMembership: mocks.requireCurrentMembership,
}));

import { getDashboardOverview } from "./dashboardController.js";

describe("getDashboardOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentMembership.mockResolvedValue({
      organizationId: "org-123",
      organization: {
        id: "org-123",
        name: "Northstar",
        setupMethod: "FRESH",
        teamStepCompletedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    mocks.propertyCount.mockResolvedValue(1);
    mocks.unitCount.mockImplementation(({ where }) =>
      Promise.resolve(where.status === "OCCUPIED" ? 3 : 4),
    );
    mocks.activeLeaseCount.mockResolvedValue(3);
    mocks.openMaintenanceCount.mockResolvedValue(1);
    mocks.collectedPayments.mockResolvedValue([
      { currency: "USD", _sum: { amount: "5400.00" } },
    ]);
    mocks.paymentTrend.mockResolvedValue([
      { month: "2026-10", currency: "USD", amount: "1800.00" },
    ]);
    mocks.properties.mockResolvedValue([
      {
        id: "property-123",
        name: "Cedar Grove",
        _count: { units: 4 },
      },
    ]);
  });

  it("returns portfolio metrics, property previews, tasks, and monthly payment trend", async () => {
    const res = { json: vi.fn().mockReturnThis() };
    await getDashboardOverview({ authUserId: "user-123" }, res);

    expect(mocks.paymentTrend).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        workspace: expect.objectContaining({ name: "Northstar" }),
        properties: [
          expect.objectContaining({
            id: "property-123",
            _count: { units: 4 },
          }),
        ],
        tasks: [],
        metrics: {
          properties: 1,
          units: 4,
          occupiedUnits: 3,
          occupancyRate: 0.75,
          activeLeases: 3,
          openMaintenance: 1,
          collectedPayments: [{ currency: "USD", amount: "5400.00" }],
          paymentTrend: [
            { month: "2026-10", currency: "USD", amount: "1800.00" },
          ],
        },
      },
    });
  });
});
