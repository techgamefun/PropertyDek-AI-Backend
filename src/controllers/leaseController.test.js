import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentMembership: vi.fn(),
  unitFindFirst: vi.fn(),
  unitUpdate: vi.fn(),
  tenantFindFirst: vi.fn(),
  tenantCreate: vi.fn(),
  leaseFindFirst: vi.fn(),
  leaseFindMany: vi.fn(),
  leaseCreate: vi.fn(),
  leaseUpdate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../config/prismaClient.js", () => ({
  default: {
    $transaction: mocks.transaction,
  },
}));

vi.mock("../services/organizationAccess.js", () => ({
  requireCurrentMembership: mocks.requireCurrentMembership,
  requireUuid: (value) => value,
}));

vi.mock("../services/cloudinaryService.js", () => ({
  deletePrivateDocument: vi.fn(),
  getPrivateDocumentDownloadUrl: vi.fn(),
  uploadPrivateDocument: vi.fn(),
}));

import { createLease, updateLease } from "./leaseController.js";

describe("leaseController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentMembership.mockResolvedValue({
      organizationId: "org-123",
      role: "OWNER",
    });
    mocks.unitFindFirst.mockResolvedValue({ id: "unit-123", status: "AVAILABLE" });
    mocks.unitUpdate.mockResolvedValue({});
    mocks.tenantFindFirst.mockResolvedValue({ id: "tenant-123" });
    mocks.tenantCreate.mockResolvedValue({ id: "tenant-123" });
    mocks.leaseFindFirst.mockResolvedValue({
      id: "lease-123",
      organizationId: "org-123",
      unitId: "unit-123",
      status: "DRAFT",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
    });
    mocks.leaseFindMany.mockResolvedValue([]);
    mocks.leaseCreate.mockImplementation(async ({ data }) => ({
      ...data,
      id: "lease-123",
      documents: [],
    }));
    mocks.leaseUpdate.mockImplementation(async ({ data }) => ({
      ...data,
      id: "lease-123",
      documents: [],
    }));
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        unit: { findFirst: mocks.unitFindFirst, update: mocks.unitUpdate },
        tenant: {
          findFirst: mocks.tenantFindFirst,
          create: mocks.tenantCreate,
        },
        lease: {
          findFirst: mocks.leaseFindFirst,
          findMany: mocks.leaseFindMany,
          create: mocks.leaseCreate,
          update: mocks.leaseUpdate,
        },
      }),
    );
  });

  it("creates a workspace-scoped lease and tenant in a serializable transaction", async () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await createLease(
      {
        authUserId: "user-123",
        body: {
          unitId: "unit-123",
          tenant: { fullName: "Jordan Lee", email: "jordan@example.com" },
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          monthlyRent: 1800,
          securityDeposit: 1800,
          status: "DRAFT",
        },
      },
      res,
    );

    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
    expect(mocks.unitFindFirst).toHaveBeenCalledWith({
      where: { id: "unit-123", property: { organizationId: "org-123" } },
      select: { id: true, status: true },
    });
    expect(mocks.tenantCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-123",
        fullName: "Jordan Lee",
        email: "jordan@example.com",
        phone: undefined,
      },
      select: { id: true },
    });
    expect(mocks.leaseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-123",
          unitId: "unit-123",
          tenantId: "tenant-123",
          status: "DRAFT",
          rentDueDay: 1,
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects overlapping active or pending lease dates for the same unit", async () => {
    mocks.leaseFindMany.mockResolvedValue([
      {
        id: "existing-lease",
        startDate: new Date("2026-06-01T00:00:00.000Z"),
        endDate: new Date("2026-12-31T00:00:00.000Z"),
      },
    ]);

    await expect(
      createLease(
        {
          authUserId: "user-123",
          body: {
            unitId: "unit-123",
            tenantId: "tenant-123",
            startDate: "2026-08-01",
            endDate: "2027-01-31",
            monthlyRent: 1800,
            status: "PENDING",
          },
        },
        { status: vi.fn(), json: vi.fn() },
      ),
    ).rejects.toMatchObject({
      code: "UNIT_LEASE_CONFLICT",
      statusCode: 409,
    });
    expect(mocks.leaseCreate).not.toHaveBeenCalled();
  });

  it("only allows non-terminal statuses when creating a lease", async () => {
    await expect(
      createLease(
        {
          authUserId: "user-123",
          body: {
            unitId: "unit-123",
            tenantId: "tenant-123",
            startDate: "2026-01-01",
            monthlyRent: 1800,
            status: "ENDED",
          },
        },
        { status: vi.fn(), json: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not allow a terminated lease to be reactivated", async () => {
    mocks.leaseFindFirst.mockResolvedValue({
      id: "lease-123",
      organizationId: "org-123",
      unitId: "unit-123",
      status: "TERMINATED",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
    });

    await expect(
      updateLease(
        {
          authUserId: "user-123",
          params: { leaseId: "lease-123" },
          body: { status: "ACTIVE" },
        },
        { json: vi.fn() },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_LEASE_TRANSITION",
      statusCode: 409,
    });
    expect(mocks.leaseUpdate).not.toHaveBeenCalled();
  });
});
