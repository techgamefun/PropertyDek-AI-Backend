import { createHash } from "node:crypto";
import { AuthServiceError } from "./authService.js";

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT =
  "https://openidconnect.googleapis.com/v1/userinfo";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new AuthServiceError(
      "GOOGLE_OAUTH_NOT_CONFIGURED",
      503,
      "Google sign-in is not configured.",
    );
  }

  const frontendOrigin = getGoogleFrontendOrigin();

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ??
    `${frontendOrigin}/api/auth/google/callback`;
  let parsedRedirectUri;
  try {
    parsedRedirectUri = new URL(redirectUri);
  } catch {
    throw new Error("GOOGLE_REDIRECT_URI must be a valid absolute URL.");
  }

  if (!["http:", "https:"].includes(parsedRedirectUri.protocol)) {
    throw new Error("GOOGLE_REDIRECT_URI must use HTTP or HTTPS.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    parsedRedirectUri.protocol !== "https:"
  ) {
    throw new Error("GOOGLE_REDIRECT_URI must use HTTPS in production.");
  }

  return { clientId, clientSecret, frontendOrigin, redirectUri };
}

export function getGoogleFrontendOrigin() {
  try {
    const frontendUrl = new URL(
      process.env.FRONTEND_URL ?? "http://localhost:3000",
    );
    if (
      !["http:", "https:"].includes(frontendUrl.protocol) ||
      (process.env.NODE_ENV === "production" &&
        frontendUrl.protocol !== "https:")
    ) {
      throw new Error();
    }

    return frontendUrl.origin;
  } catch {
    throw new Error("FRONTEND_URL must use HTTP or HTTPS.");
  }
}

export function createGoogleAuthorizationUrl(state, codeVerifier) {
  const { clientId, redirectUri } = getGoogleOAuthConfig();
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: createHash("sha256")
      .update(codeVerifier)
      .digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  return url.toString();
}

export async function exchangeGoogleCode(code, codeVerifier) {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
  const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenResponse.ok) {
    throw new Error("Google rejected the authorization code.");
  }

  const tokenData = await tokenResponse.json();
  if (typeof tokenData.access_token !== "string" || !tokenData.access_token) {
    throw new Error("Google did not return an access token.");
  }

  const userInfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!userInfoResponse.ok) {
    throw new Error("Google user information could not be verified.");
  }

  const userInfo = await userInfoResponse.json();
  const email =
    typeof userInfo.email === "string" ? userInfo.email.trim().toLowerCase() : "";
  const name = typeof userInfo.name === "string" ? userInfo.name.trim() : "";
  const avatarUrl =
    typeof userInfo.picture === "string" &&
    userInfo.picture.startsWith("https://") &&
    userInfo.picture.length <= 2048
      ? userInfo.picture
      : null;

  if (
    typeof userInfo.sub !== "string" ||
    !userInfo.sub ||
    userInfo.sub.length > 255 ||
    !email ||
    email.length > 320 ||
    !EMAIL_PATTERN.test(email) ||
    userInfo.email_verified !== true
  ) {
    throw new Error("Google did not return a verified account.");
  }

  return {
    googleId: userInfo.sub,
    email,
    fullName: (name || email).slice(0, 160),
    avatarUrl,
  };
}
