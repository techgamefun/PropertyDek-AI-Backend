import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  create: vi.fn(),
  authSessionCreate: vi.fn(),
  authSessionFindUnique: vi.fn(),
  authSessionUpdateMany: vi.fn(),
  findUnique: vi.fn(),
  hash: vi.fn(),
  sign: vi.fn(),
  update: vi.fn(),
}));

vi.mock("bcrypt", () => ({
  default: {
    compare: mocks.compare,
    hash: mocks.hash,
  },
}));

vi.mock("jsonwebtoken", () => ({
  default: {
    sign: mocks.sign,
  },
}));

vi.mock("../config/prismaClient.js", () => ({
  default: {
    user: {
      create: mocks.create,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    authSession: {
      create: mocks.authSessionCreate,
      findUnique: mocks.authSessionFindUnique,
      updateMany: mocks.authSessionUpdateMany,
    },
  },
}));

import {
  AuthServiceError,
  loginUser,
  loginWithGoogle,
  logoutSession,
  refreshSession,
  registerUser,
} from "./authService.js";
import { createHash } from "node:crypto";

describe("loginUser", () => {
  const user = {
    id: "user-123",
    email: "samir@example.com",
    fullName: "Samir",
    passwordHash: "$2b$12$password-hash",
    phone: null,
    avatarUrl: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JWT_SECRET", "a".repeat(48));
    mocks.hash.mockResolvedValue("$2b$12$password-hash");
    mocks.findUnique.mockResolvedValue(user);
    mocks.compare.mockResolvedValue(true);
    mocks.sign.mockReturnValue("signed-session-token");
    mocks.authSessionCreate.mockResolvedValue({ id: "session-123" });
    mocks.authSessionFindUnique.mockResolvedValue({
      id: "session-123",
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
  });

  it("persists phone and Cloudinary avatar URL on registration", async () => {
    const registeredUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: "+1 555 123 4567",
      avatarUrl: "https://res.cloudinary.com/demo/image/upload/avatar.jpg",
      createdAt: user.createdAt,
    };
    mocks.create.mockResolvedValue(registeredUser);

    const result = await registerUser({
      fullName: user.fullName,
      email: user.email,
      password: "a secure password",
      phone: registeredUser.phone,
      avatarUrl: registeredUser.avatarUrl,
    });

    expect(mocks.hash).toHaveBeenCalledWith("a secure password", 12);
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        fullName: user.fullName,
        email: user.email,
        passwordHash: "$2b$12$password-hash",
        phone: registeredUser.phone,
        avatarUrl: registeredUser.avatarUrl,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
    expect(result.user).toEqual(registeredUser);
    expect(result.tokens).toEqual({
      accessToken: "signed-session-token",
      refreshToken: expect.any(String),
    });
    expect(mocks.authSessionCreate).toHaveBeenCalledWith({
      data: {
        userId: registeredUser.id,
        refreshTokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      },
      select: { id: true },
    });
    expect(mocks.sign).toHaveBeenCalledWith(
      { tokenUse: "access", sid: "session-123" },
      "a".repeat(48),
      { subject: registeredUser.id, expiresIn: 900 },
    );
  });

  it("returns a safe user profile and creates an access/refresh token pair", async () => {
    const result = await loginUser({
      email: user.email,
      password: "a secure password",
    });

    expect(result.user).toEqual({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    });
    expect(result.user).not.toHaveProperty("passwordHash");
    expect(result.tokens.accessToken).toBe("signed-session-token");
    expect(result.tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(mocks.sign).toHaveBeenCalledWith(
      { tokenUse: "access", sid: "session-123" },
      "a".repeat(48),
      { subject: user.id, expiresIn: 900 },
    );
    const storedSession = mocks.authSessionCreate.mock.calls[0][0];
    expect(storedSession.data.refreshTokenHash).toBe(
      createHash("sha256").update(result.tokens.refreshToken).digest("hex"),
    );
    expect(storedSession.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("creates an account and session for a verified Google identity", async () => {
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mocks.create.mockResolvedValue({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      authProviderId: "google-sub-123",
    });

    const result = await loginWithGoogle({
      googleId: "google-sub-123",
      email: user.email,
      fullName: user.fullName,
      avatarUrl: "https://lh3.googleusercontent.com/avatar",
    });

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        authProviderId: "google-sub-123",
        email: user.email,
        fullName: user.fullName,
        avatarUrl: "https://lh3.googleusercontent.com/avatar",
      },
      select: expect.objectContaining({ authProviderId: true }),
    });
    expect(result.user).not.toHaveProperty("authProviderId");
    expect(result.user).not.toHaveProperty("passwordHash");
    expect(result.tokens).toEqual({
      accessToken: "signed-session-token",
      refreshToken: expect.any(String),
    });
  });

  it("links an existing password account by verified email", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...user,
        authProviderId: null,
      });
    mocks.update.mockResolvedValue({
      ...user,
      authProviderId: "google-sub-123",
    });

    const result = await loginWithGoogle({
      googleId: "google-sub-123",
      email: user.email,
      fullName: "Updated Google Name",
      avatarUrl: "https://lh3.googleusercontent.com/avatar",
    });

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {
        authProviderId: "google-sub-123",
        avatarUrl: "https://lh3.googleusercontent.com/avatar",
      },
      select: expect.objectContaining({ authProviderId: true }),
    });
    expect(result.user.fullName).toBe(user.fullName);
  });

  it("rejects a Google identity already linked to a different account", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...user,
        authProviderId: "different-google-sub",
      });

    await expect(
      loginWithGoogle({
        googleId: "google-sub-123",
        email: user.email,
        fullName: user.fullName,
        avatarUrl: null,
      }),
    ).rejects.toMatchObject({
      code: "GOOGLE_ACCOUNT_CONFLICT",
      statusCode: 409,
    });
    expect(mocks.authSessionCreate).not.toHaveBeenCalled();
  });

  it("uses the stable Google ID when the verified email changes", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      id: user.id,
      authProviderId: "google-sub-123",
      email: "old@example.com",
      fullName: user.fullName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    });
    mocks.findUnique.mockResolvedValueOnce(null);
    mocks.update.mockResolvedValue({
      id: user.id,
      authProviderId: "google-sub-123",
      email: "new@example.com",
      fullName: user.fullName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    });

    const result = await loginWithGoogle({
      googleId: "google-sub-123",
      email: "new@example.com",
      fullName: user.fullName,
      avatarUrl: null,
    });

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: user.id },
        data: { email: "new@example.com" },
      }),
    );
    expect(result.user.email).toBe("new@example.com");
  });

  it("issues a new access token for a valid refresh token", async () => {
    const result = await refreshSession("refresh-token");

    expect(mocks.authSessionFindUnique).toHaveBeenCalledWith({
      where: {
        refreshTokenHash: createHash("sha256").update("refresh-token").digest("hex"),
      },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    expect(result).toEqual({ accessToken: "signed-session-token" });
    expect(mocks.sign).toHaveBeenCalledWith(
      { tokenUse: "access", sid: "session-123" },
      "a".repeat(48),
      { subject: user.id, expiresIn: 900 },
    );
  });

  it.each([
    ["missing", null],
    ["unknown", "unknown-refresh-token"],
  ])("rejects a %s refresh token", async (_description, token) => {
    if (token) {
      mocks.authSessionFindUnique.mockResolvedValue(null);
    }

    await expect(refreshSession(token)).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
      statusCode: 401,
    });
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("rejects expired or revoked sessions", async () => {
    mocks.authSessionFindUnique.mockResolvedValue({
      id: "session-123",
      userId: user.id,
      expiresAt: new Date(Date.now() - 1),
      revokedAt: null,
    });

    await expect(refreshSession("refresh-token")).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
  });

  it("revokes the matching session on logout", async () => {
    await logoutSession("refresh-token");

    expect(mocks.authSessionUpdateMany).toHaveBeenCalledWith({
      where: {
        refreshTokenHash: createHash("sha256").update("refresh-token").digest("hex"),
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("uses the same credential error for unknown users", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.compare.mockResolvedValue(false);

    await expect(
      loginUser({ email: "unknown@example.com", password: "wrong-password" }),
    ).rejects.toMatchObject({
      name: "AuthServiceError",
      code: "INVALID_CREDENTIALS",
      statusCode: 401,
      message: "Email or password is incorrect.",
    });
    expect(mocks.compare).toHaveBeenCalledWith(
      "wrong-password",
      expect.stringMatching(/^\$2b\$12\$/u),
    );
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("rejects login when the account password does not match", async () => {
    mocks.compare.mockResolvedValue(false);

    await expect(
      loginUser({ email: user.email, password: "wrong-password" }),
    ).rejects.toBeInstanceOf(AuthServiceError);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("requires a sufficiently long JWT secret", async () => {
    vi.stubEnv("JWT_SECRET", "too-short");

    await expect(
      loginUser({ email: user.email, password: "correct-password" }),
    ).rejects.toThrow("JWT_SECRET must be configured with at least 32 bytes");
  });
});
