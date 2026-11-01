import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentMembership: vi.fn(),
  propertyFindFirst: vi.fn(),
  unitFindFirst: vi.fn(),
  tenantFindFirst: vi.fn(),
  requestFindFirst: vi.fn(),
  requestFindMany: vi.fn(),
  requestCreate: vi.fn(),
  requestUpdate: vi.fn(),
  commentCreate: vi.fn(),
}));

vi.mock("../config/prismaClient.js", () => ({
  default: {
    property: { findFirst: mocks.propertyFindFirst },
    unit: { findFirst: mocks.unitFindFirst },
    tenant: { findFirst: mocks.tenantFindFirst },
    maintenanceRequest: {
      findFirst: mocks.requestFindFirst,
      findMany: mocks.requestFindMany,
      create: mocks.requestCreate,
      update: mocks.requestUpdate,
    },
    maintenanceComment: { create: mocks.commentCreate },
  },
}));

vi.mock("../services/organizationAccess.js", () => ({
  requireCurrentMembership: mocks.requireCurrentMembership,
  requireUuid: (value) => value,
}));

import {
  addMaintenanceComment,
  createMaintenanceRequest,
  listMaintenanceRequests,
  updateMaintenanceRequest,
} from "./maintenanceController.js";

describe("maintenanceController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentMembership.mockResolvedValue({
      organizationId: "org-123",
      role: "OWNER",
    });
    mocks.propertyFindFirst.mockResolvedValue({ id: "property-123" });
    mocks.unitFindFirst.mockResolvedValue({ id: "unit-123" });
    mocks.tenantFindFirst.mockResolvedValue({ id: "tenant-123" });
    mocks.requestFindFirst.mockResolvedValue({ id: "request-123" });
    mocks.requestFindMany.mockResolvedValue([]);
    mocks.requestCreate.mockImplementation(async ({ data }) => ({
      id: "request-123",
      documents: [],
      ...data,
    }));
    mocks.requestUpdate.mockImplementation(async ({ data }) => ({
      id: "request-123",
      documents: [],
      ...data,
    }));
    mocks.commentCreate.mockImplementation(async ({ data }) => ({ id: "comment-123", ...data }));
  });

  it("lists only requests in the current workspace and validates filters", async () => {
    const res = { json: vi.fn().mockReturnThis() };
    await listMaintenanceRequests(
      {
        authUserId: "user-123",
        query: { status: "OPEN", priority: "URGENT", propertyId: "property-123" },
      },
      res,
    );
    expect(mocks.requestFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-123",
          status: "OPEN",
          priority: "URGENT",
          propertyId: "property-123",
        },
      }),
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { requests: [] },
    });
  });

  it("creates a request only for a property and unit in the workspace", async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await createMaintenanceRequest(
      {
        authUserId: "user-123",
        body: {
          propertyId: "property-123",
          unitId: "unit-123",
          title: "Repair sink",
          description: "The kitchen sink is leaking.",
          priority: "HIGH",
        },
      },
      res,
    );
    expect(mocks.propertyFindFirst).toHaveBeenCalledWith({
      where: { id: "property-123", organizationId: "org-123" },
      select: { id: true },
    });
    expect(mocks.unitFindFirst).toHaveBeenCalledWith({
      where: { id: "unit-123", propertyId: "property-123" },
      select: { id: true },
    });
    expect(mocks.requestCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-123",
          propertyId: "property-123",
          unitId: "unit-123",
          priority: "HIGH",
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("records completion time when a request is completed", async () => {
    const res = { json: vi.fn().mockReturnThis() };
    await updateMaintenanceRequest(
      {
        authUserId: "user-123",
        params: { requestId: "request-123" },
        body: { status: "COMPLETED" },
      },
      res,
    );
    expect(mocks.requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "request-123" },
        data: expect.objectContaining({
          status: "COMPLETED",
          completedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("adds a non-internal comment to a workspace request", async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await addMaintenanceComment(
      {
        authUserId: "user-123",
        params: { requestId: "request-123" },
        body: { body: "Technician scheduled for tomorrow." },
      },
      res,
    );
    expect(mocks.commentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          maintenanceRequestId: "request-123",
          authorUserId: "user-123",
          body: "Technician scheduled for tomorrow.",
          isInternal: false,
        },
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
