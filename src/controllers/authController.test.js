import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  AuthServiceError: class AuthServiceError extends Error {
    constructor(code, statusCode, message) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  },
  loginUser: vi.fn(),
  loginWithGoogle: vi.fn(),
  logoutSession: vi.fn(),
  refreshSession: vi.fn(),
  registerUser: vi.fn(),
  uploadImage: vi.fn(),
  deleteImage: vi.fn(),
}));

vi.mock("../services/authService.js", () => ({
  AuthServiceError: mocks.AuthServiceError,
  loginUser: mocks.loginUser,
  logoutSession: mocks.logoutSession,
  refreshSession: mocks.refreshSession,
  registerUser: mocks.registerUser,
  loginWithGoogle: mocks.loginWithGoogle,
}));

vi.mock("../services/cloudinaryService.js", () => ({
  uploadImage: mocks.uploadImage,
  deleteImage: mocks.deleteImage,
}));

vi.mock("../services/googleOAuthService.js", () => ({
  createGoogleAuthorizationUrl: vi.fn(() => "https://accounts.google.test/auth"),
  exchangeGoogleCode: vi.fn(),
  getGoogleFrontendOrigin: vi.fn(() => "http://localhost:3000"),
}));

import { login, logout, refresh, register } from "./authController.js";

describe("login controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads the selected avatar and registers its secure Cloudinary URL", async () => {
    const user = {
      id: "user-123",
      email: "samir@example.com",
      fullName: "Samir",
      phone: "+1 555 123 4567",
      avatarUrl: "https://res.cloudinary.com/demo/image/upload/avatar.jpg",
    };
    const registration = {
      fullName: user.fullName,
      email: user.email,
      password: "a secure password",
      phone: user.phone,
    };
    const file = { buffer: Buffer.from("image-data") };
    mocks.uploadImage.mockResolvedValue({
      secure_url: user.avatarUrl,
      public_id: "propertydek/avatar",
    });
    mocks.registerUser.mockResolvedValue({
      user,
      tokens: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
    const res = {
      locals: { registration },
      cookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await register({ file }, res);

    expect(mocks.uploadImage).toHaveBeenCalledWith(file.buffer);
    expect(mocks.registerUser).toHaveBeenCalledWith({
      ...registration,
      avatarUrl: user.avatarUrl,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { user },
    });
    expect(mocks.deleteImage).not.toHaveBeenCalled();
  });

  it("allows registration without an avatar", async () => {
    const user = {
      id: "user-456",
      email: "samir@example.com",
      fullName: "Samir",
      phone: null,
      avatarUrl: null,
    };
    mocks.registerUser.mockResolvedValue({
      user,
      tokens: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
    const res = {
      locals: { registration: { fullName: user.fullName, email: user.email } },
      cookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await register({ file: undefined }, res);

    expect(mocks.uploadImage).not.toHaveBeenCalled();
    expect(mocks.registerUser).toHaveBeenCalledWith({
      ...res.locals.registration,
      avatarUrl: null,
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("removes an uploaded avatar if account creation fails", async () => {
    const error = new Error("account creation failed");
    mocks.uploadImage.mockResolvedValue({
      secure_url: "https://res.cloudinary.com/demo/image/upload/avatar.jpg",
      public_id: "propertydek/avatar",
    });
    mocks.registerUser.mockRejectedValue(error);
    mocks.deleteImage.mockResolvedValue({ result: "ok" });
    const res = { locals: { registration: {} } };

    await expect(register({ file: { buffer: Buffer.from("image-data") } }, res))
      .rejects.toBe(error);

    expect(mocks.deleteImage).toHaveBeenCalledWith("propertydek/avatar");
  });

  it("sets an HttpOnly session cookie and returns only the user profile", async () => {
    const user = {
      id: "user-123",
      email: "samir@example.com",
      fullName: "Samir",
    };
    mocks.loginUser.mockResolvedValue({
      user,
      tokens: { accessToken: "access-token", refreshToken: "refresh-token" },
    });

    const res = {
      locals: { credentials: { email: user.email, password: "password" } },
      cookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await login({ body: {} }, res);

    expect(mocks.loginUser).toHaveBeenCalledWith({
      email: user.email,
      password: "password",
    });
    expect(res.cookie).toHaveBeenNthCalledWith(
      1,
      "propertydek_access",
      "access-token",
      {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
        maxAge: 900000,
      },
    );
    expect(res.cookie).toHaveBeenNthCalledWith(
      2,
      "propertydek_refresh",
      "refresh-token",
      {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/api/auth",
        maxAge: 604800000,
      },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { user },
    });
  });

  it("redirects to Google and stores state and PKCE verifier in a protected cookie", async () => {
    const res = {
      cookie: vi.fn(),
      redirect: vi.fn(),
    };

    const { googleLogin } = await import("./authController.js");
    googleLogin({}, res);

    expect(res.cookie).toHaveBeenCalledWith(
      "propertydek_google_state",
      expect.stringMatching(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/u),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 600_000,
      }),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      "https://accounts.google.test/auth",
    );
  });

  it("exchanges a valid Google callback for the app's HttpOnly session", async () => {
    const profile = {
      googleId: "google-sub-123",
      email: "samir@example.com",
      fullName: "Samir",
      avatarUrl: null,
    };
    const user = { id: "user-123", email: profile.email, fullName: "Samir" };
    const { exchangeGoogleCode } = await import("../services/googleOAuthService.js");
    exchangeGoogleCode.mockResolvedValue(profile);
    mocks.loginWithGoogle.mockResolvedValue({
      user,
      tokens: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
    const state = "a".repeat(43);
    const verifier = "b".repeat(43);
    const res = {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
      redirect: vi.fn(),
    };

    const { googleCallback } = await import("./authController.js");
    await googleCallback(
      {
        headers: { cookie: `propertydek_google_state=${state}.${verifier}` },
        query: { state, code: "authorization-code" },
      },
      res,
    );

    expect(exchangeGoogleCode).toHaveBeenCalledWith(
      "authorization-code",
      verifier,
    );
    expect(mocks.loginWithGoogle).toHaveBeenCalledWith(profile);
    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.redirect).toHaveBeenCalledWith(
      303,
      "http://localhost:3000/onboarding",
    );
  });

  it("rejects a Google callback with an invalid state", async () => {
    const { exchangeGoogleCode } = await import("../services/googleOAuthService.js");
    const { googleCallback } = await import("./authController.js");
    const res = { clearCookie: vi.fn(), redirect: vi.fn() };

    await googleCallback(
      {
        headers: { cookie: "propertydek_google_state=expected.verifier" },
        query: { state: "attacker", code: "authorization-code" },
      },
      res,
    );

    expect(exchangeGoogleCode).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      303,
      "http://localhost:3000/login?oauthError=google",
    );
  });
});

describe("refresh and logout controllers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the access cookie without returning tokens", async () => {
    mocks.refreshSession.mockResolvedValue({ accessToken: "next-access-token" });
    const res = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await refresh(
      { headers: { cookie: "propertydek_refresh=refresh-token" } },
      res,
    );

    expect(mocks.refreshSession).toHaveBeenCalledWith("refresh-token");
    expect(res.cookie).toHaveBeenCalledWith(
      "propertydek_access",
      "next-access-token",
      expect.objectContaining({ httpOnly: true, maxAge: 900000 }),
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: {} });
  });

  it("clears cookies when the refresh token is no longer valid", async () => {
    mocks.refreshSession.mockRejectedValue(
      new mocks.AuthServiceError(
        "INVALID_REFRESH_TOKEN",
        401,
        "Your session has expired.",
      ),
    );
    const res = { clearCookie: vi.fn() };

    await expect(
      refresh(
        { headers: { cookie: "propertydek_refresh=expired-token" } },
        res,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REFRESH_TOKEN" });

    expect(res.clearCookie).toHaveBeenCalledTimes(2);
  });

  it("revokes the refresh session and clears both cookies on logout", async () => {
    const res = {
      clearCookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await logout(
      { headers: { cookie: "propertydek_refresh=refresh-token" } },
      res,
    );

    expect(mocks.logoutSession).toHaveBeenCalledWith("refresh-token");
    expect(res.clearCookie).toHaveBeenNthCalledWith(
      1,
      "propertydek_access",
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
    expect(res.clearCookie).toHaveBeenNthCalledWith(
      2,
      "propertydek_refresh",
      expect.objectContaining({ httpOnly: true, path: "/api/auth" }),
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: {} });
  });
});
