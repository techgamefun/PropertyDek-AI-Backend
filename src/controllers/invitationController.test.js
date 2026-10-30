import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  findInvitation: vi.fn(),
  claimInvitation: vi.fn(),
  findMembership: vi.fn(),
  upsertMembership: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../config/prismaClient.js", () => ({
  default: {
    user: { findUnique: mocks.findUser },
    invitation: { findUnique: mocks.findInvitation },
    $transaction: mocks.transaction,
  },
}));

import { acceptInvitation } from "./invitationController.js";

describe("acceptInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUser.mockResolvedValue({
      id: "user-123",
      email: "teammate@example.com",
    });
    mocks.findInvitation.mockResolvedValue({
      id: "invitation-123",
      organizationId: "org-123",
      email: "teammate@example.com",
      role: "VIEWER",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.claimInvitation.mockResolvedValue({ count: 1 });
    mocks.findMembership.mockResolvedValue(null);
    mocks.upsertMembership.mockResolvedValue({ role: "VIEWER", status: "ACTIVE" });
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        invitation: { updateMany: mocks.claimInvitation },
        membership: {
          findUnique: mocks.findMembership,
          upsert: mocks.upsertMembership,
        },
      }),
    );
  });

  it("assigns the role stored in the invitation, ignoring a client role", async () => {
    const res = { json: vi.fn().mockReturnThis() };

    await acceptInvitation(
      {
        authUserId: "user-123",
        body: { token: "one-time-token", role: "OWNER" },
      },
      res,
    );

    expect(mocks.claimInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING" }),
      }),
    );
    expect(mocks.upsertMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          organizationId: "org-123",
          userId: "user-123",
          role: "VIEWER",
          status: "ACTIVE",
        }),
        update: expect.objectContaining({ role: "VIEWER" }),
      }),
    );
  });

  it("rejects acceptance by an account with a different email", async () => {
    mocks.findUser.mockResolvedValue({
      id: "user-123",
      email: "another@example.com",
    });

    await expect(
      acceptInvitation(
        {
          authUserId: "user-123",
          body: { token: "one-time-token" },
        },
        { json: vi.fn() },
      ),
    ).rejects.toMatchObject({
      code: "INVITATION_EMAIL_MISMATCH",
      statusCode: 403,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
