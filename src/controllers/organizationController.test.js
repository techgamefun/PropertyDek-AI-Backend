import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOrganization: vi.fn(),
  createMembership: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../config/prismaClient.js", () => ({
  default: {
    $transaction: mocks.transaction,
  },
}));

import { createOrganization } from "./organizationController.js";

describe("createOrganization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOrganization.mockResolvedValue({
      id: "org-123",
      name: "Northstar",
      countryCode: "US",
      timezone: "America/Los_Angeles",
    });
    mocks.createMembership.mockResolvedValue({ role: "OWNER" });
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        organization: { create: mocks.createOrganization },
        membership: { create: mocks.createMembership },
      }),
    );
  });

  it("creates the workspace and active owner membership in one transaction", async () => {
    const req = {
      authUserId: "user-123",
      body: {
        name: "Northstar",
        countryCode: "us",
        timezone: "America/Los_Angeles",
      },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await createOrganization(req, res);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.createOrganization).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Northstar",
        countryCode: "US",
        timezone: "America/Los_Angeles",
        slug: expect.stringMatching(/^northstar-[a-f0-9]{8}$/u),
      }),
    });
    expect(mocks.createMembership).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-123",
        userId: "user-123",
        role: "OWNER",
        status: "ACTIVE",
      }),
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
