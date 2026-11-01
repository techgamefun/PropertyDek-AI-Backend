import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentMembership: vi.fn(),
  tenantFindMany: vi.fn(),
  tenantFindFirst: vi.fn(),
  tenantCreate: vi.fn(),
  tenantUpdate: vi.fn(),
  tenantDelete: vi.fn(),
  transaction: vi.fn(),
  uploadImage: vi.fn(),
  deleteImage: vi.fn(),
  getCloudinaryImagePublicId: vi.fn(),
}));

vi.mock("../config/prismaClient.js", () => ({
  default: {
    tenant: {
      findMany: mocks.tenantFindMany,
      findFirst: mocks.tenantFindFirst,
      create: mocks.tenantCreate,
      update: mocks.tenantUpdate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../services/cloudinaryService.js", () => ({
  deleteImage: mocks.deleteImage,
  getCloudinaryImagePublicId: mocks.getCloudinaryImagePublicId,
  uploadImage: mocks.uploadImage,
}));

vi.mock("../services/organizationAccess.js", () => ({
  requireCurrentMembership: mocks.requireCurrentMembership,
  requireUuid: (value) => value,
}));

import {
  createTenant,
  deleteTenant,
  getTenant,
  listTenants,
  updateTenant,
} from "./tenantController.js";

describe("tenantController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentMembership.mockResolvedValue({
      organizationId: "org-123",
      role: "OWNER",
    });
    mocks.tenantFindMany.mockResolvedValue([]);
    mocks.tenantFindFirst.mockResolvedValue({ id: "tenant-123", _count: { leases: 0 } });
    mocks.tenantCreate.mockImplementation(async ({ data }) => ({ id: "tenant-123", ...data }));
    mocks.tenantUpdate.mockImplementation(async ({ data }) => ({ id: "tenant-123", ...data }));
    mocks.tenantDelete.mockResolvedValue({ id: "tenant-123" });
    mocks.uploadImage.mockResolvedValue({
      secure_url: "https://res.cloudinary.com/demo/image/upload/tenant.jpg",
      public_id: "propertydek/tenant",
    });
    mocks.getCloudinaryImagePublicId.mockReturnValue(null);
    mocks.deleteImage.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        tenant: {
          findFirst: mocks.tenantFindFirst,
          delete: mocks.tenantDelete,
        },
      }),
    );
  });

  it("lists only current-workspace tenants and supports case-insensitive search", async () => {
    const res = { json: vi.fn().mockReturnThis() };
    await listTenants(
      { authUserId: "user-123", query: { search: "lee" } },
      res,
    );
    expect(mocks.tenantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-123",
          OR: [
            { fullName: { contains: "lee", mode: "insensitive" } },
            { email: { contains: "lee", mode: "insensitive" } },
            { phone: { contains: "lee", mode: "insensitive" } },
          ],
        },
      }),
    );
  });

  it("creates a tenant with the complete contact profile", async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await createTenant(
      {
        authUserId: "user-123",
        body: {
          fullName: " Jordan Lee ",
          email: "JORDAN@example.com",
          phone: "555-0100",
          emergencyContact: "Casey Lee",
          emergencyPhone: "555-0101",
          notes: "Prefers email.",
        },
      },
      res,
    );
    expect(mocks.tenantCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-123",
        fullName: "Jordan Lee",
        email: "jordan@example.com",
        phone: "555-0100",
        emergencyContact: "Casey Lee",
        emergencyPhone: "555-0101",
        notes: "Prefers email.",
      },
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects tenant writes by read-only workspace members", async () => {
    mocks.requireCurrentMembership.mockResolvedValue({
      organizationId: "org-123",
      role: "VIEWER",
    });
    await expect(
      createTenant({ authUserId: "user-123", body: { fullName: "Jordan Lee" } }, {}),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_PERMISSIONS" });
    expect(mocks.tenantCreate).not.toHaveBeenCalled();
  });

  it("loads a tenant only from the current workspace", async () => {
    const res = { json: vi.fn().mockReturnThis() };
    await getTenant(
      { authUserId: "user-123", params: { tenantId: "tenant-123" } },
      res,
    );
    expect(mocks.tenantFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tenant-123", organizationId: "org-123" },
        include: expect.objectContaining({
          leases: expect.any(Object),
          maintenanceRequests: expect.any(Object),
        }),
      }),
    );
  });

  it("updates tenant contact fields only after confirming workspace ownership", async () => {
    const res = { json: vi.fn().mockReturnThis() };
    await updateTenant(
      {
        authUserId: "user-123",
        params: { tenantId: "tenant-123" },
        body: { phone: "555-0110", emergencyPhone: null },
      },
      res,
    );
    expect(mocks.tenantFindFirst).toHaveBeenCalledWith({
      where: { id: "tenant-123", organizationId: "org-123" },
      select: { id: true, avatarUrl: true },
    });

    expect(mocks.tenantUpdate).toHaveBeenCalledWith({
      where: { id: "tenant-123" },
      data: { phone: "555-0110", emergencyPhone: null },
    });
  });

  it("stores an uploaded tenant photo", async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await createTenant(
      {
        authUserId: "user-123",
        body: { fullName: "Jordan Lee" },
        file: { buffer: Buffer.from("photo") },
      },
      res,
    );

    expect(mocks.tenantCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-123",
        fullName: "Jordan Lee",
        avatarUrl: "https://res.cloudinary.com/demo/image/upload/tenant.jpg",
      },
    });
  });

  it("removes a tenant photo when requested", async () => {
    mocks.tenantFindFirst.mockResolvedValue({
      id: "tenant-123",
      avatarUrl: "https://res.cloudinary.com/demo/image/upload/tenant.jpg",
    });
    mocks.getCloudinaryImagePublicId.mockReturnValue("propertydek/tenant");
    const res = { json: vi.fn().mockReturnThis() };
    await updateTenant(
      {
        authUserId: "user-123",
        params: { tenantId: "tenant-123" },
        body: { removeAvatar: true },
      },
      res,
    );

    expect(mocks.tenantUpdate).toHaveBeenCalledWith({
      where: { id: "tenant-123" },
      data: { avatarUrl: null },
    });
    expect(mocks.deleteImage).toHaveBeenCalledWith("propertydek/tenant");
  });

  it("deletes tenants without leases and protects tenant lease history", async () => {
    const res = { json: vi.fn().mockReturnThis() };
    await deleteTenant(
      { authUserId: "user-123", params: { tenantId: "tenant-123" } },
      res,
    );
    expect(mocks.tenantDelete).toHaveBeenCalledWith({ where: { id: "tenant-123" } });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { deleted: true } });

    mocks.tenantFindFirst.mockResolvedValueOnce({
      id: "tenant-123",
      _count: { leases: 1 },
    });
    await expect(
      deleteTenant(
        { authUserId: "user-123", params: { tenantId: "tenant-123" } },
        res,
      ),
    ).rejects.toMatchObject({ code: "TENANT_HAS_LEASES", statusCode: 409 });
    expect(mocks.tenantDelete).toHaveBeenCalledOnce();
  });
});
