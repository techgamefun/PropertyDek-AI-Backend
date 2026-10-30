import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("jsonwebtoken", () => ({
  default: { verify: mocks.verify },
}));

vi.mock("../config/prismaClient.js", () => ({
  default: { authSession: { findUnique: mocks.findUnique } },
}));

import { authenticateUser } from "./authenticateUser.js";

describe("authenticateUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JWT_SECRET", "a".repeat(48));
    mocks.verify.mockReturnValue({
      sub: "user-123",
      sid: "session-123",
      tokenUse: "access",
    });
    mocks.findUnique.mockResolvedValue({
      id: "session-123",
      userId: "user-123",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
  });

  it("accepts a valid access token only when its session is active", async () => {
    const req = {
      get: vi.fn().mockReturnValue(null),
      headers: { cookie: "propertydek_access=access-token" },
    };
    const next = vi.fn();

    await authenticateUser(req, {}, next);

    expect(mocks.verify).toHaveBeenCalledWith(
      "access-token",
      "a".repeat(48),
      { algorithms: ["HS256"] },
    );
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: "session-123" },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    expect(req.authUserId).toBe("user-123");
    expect(req.authSessionId).toBe("session-123");
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects a revoked session", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "session-123",
      userId: "user-123",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
    });
    const next = vi.fn();

    await authenticateUser(
      {
        get: vi.fn().mockReturnValue(null),
        headers: { cookie: "propertydek_access=access-token" },
      },
      {},
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_SESSION", statusCode: 401 }),
    );
  });
});
