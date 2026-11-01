import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGoogleAuthorizationUrl,
  exchangeGoogleCode,
  getGoogleOAuthConfig,
} from "./googleOAuthService.js";

describe("Google OAuth service", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("builds an authorization URL with a PKCE challenge", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("FRONTEND_URL", "http://localhost:3000");
    vi.stubEnv(
      "GOOGLE_REDIRECT_URI",
      "http://localhost:3000/api/auth/google/callback",
    );

    const url = new URL(createGoogleAuthorizationUrl("state-value", "verifier"));

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/google/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      "iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ",
    );
  });

  it("exchanges the code and accepts only verified Google email claims", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost:3000/google-callback");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "google-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: "google-sub-123",
          email: "  SAMIR@example.com ",
          email_verified: true,
          name: "Samir",
          picture: "https://lh3.googleusercontent.com/avatar",
        }),
      });
    vi.stubGlobal("fetch", fetch);

    const profile = await exchangeGoogleCode("authorization-code", "verifier");

    expect(fetch).toHaveBeenCalledTimes(2);
    const tokenRequest = fetch.mock.calls[0][1];
    expect(tokenRequest.method).toBe("POST");
    expect(tokenRequest.body.get("code")).toBe("authorization-code");
    expect(tokenRequest.body.get("code_verifier")).toBe("verifier");
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer google-access-token",
    );
    expect(profile).toEqual({
      googleId: "google-sub-123",
      email: "samir@example.com",
      fullName: "Samir",
      avatarUrl: "https://lh3.googleusercontent.com/avatar",
    });
  });

  it("rejects unverified Google email claims", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "google-access-token" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            sub: "google-sub-123",
            email: "samir@example.com",
            email_verified: false,
          }),
        }),
    );

    await expect(exchangeGoogleCode("authorization-code", "verifier")).rejects
      .toThrow("Google did not return a verified account.");
  });

  it("requires Google client credentials", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");

    expect(() => getGoogleOAuthConfig()).toThrow(
      "Google sign-in is not configured.",
    );
  });
});
