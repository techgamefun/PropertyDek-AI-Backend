import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  AuthServiceError,
  loginUser,
  loginWithGoogle,
  logoutSession,
  refreshSession,
  registerUser,
} from "../services/authService.js";
import { deleteImage, uploadImage } from "../services/cloudinaryService.js";
import {
  createGoogleAuthorizationUrl,
  exchangeGoogleCode,
  getGoogleFrontendOrigin,
} from "../services/googleOAuthService.js";

const ACCESS_COOKIE = "propertydek_access";
const REFRESH_COOKIE = "propertydek_refresh";
const GOOGLE_STATE_COOKIE = "propertydek_google_state";
const ACCESS_TOKEN_DURATION_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const GOOGLE_STATE_DURATION_MS = 10 * 60 * 1000;

export async function register(req, res) {
  const uploadedAvatar = req.file
    ? await uploadImage(req.file.buffer)
    : undefined;

  let result;
  try {
    result = await registerUser({
      ...res.locals.registration,
      avatarUrl: uploadedAvatar?.secure_url ?? null,
    });
  } catch (error) {
    if (uploadedAvatar?.public_id) {
      try {
        await deleteImage(uploadedAvatar.public_id);
      } catch (cleanupError) {
        console.error("Failed to remove an unused Cloudinary avatar:", cleanupError);
      }
    }

    throw error;
  }

  const { user, tokens } = result;

  setAuthCookies(res, tokens);
  return res.status(201).json({
    success: true,
    data: { user },
  });
}

export async function login(req, res) {
  const { user, tokens } = await loginUser(res.locals.credentials);

  setAuthCookies(res, tokens);

  return res.status(200).json({
    success: true,
    data: { user },
  });
}

export function googleLogin(req, res) {
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  let authorizationUrl;
  try {
    authorizationUrl = createGoogleAuthorizationUrl(state, codeVerifier);
  } catch (error) {
    if (
      error instanceof AuthServiceError &&
      error.code === "GOOGLE_OAUTH_NOT_CONFIGURED"
    ) {
      return redirectToLogin(res, "google-unavailable");
    }
    throw error;
  }

  res.cookie(
    GOOGLE_STATE_COOKIE,
    `${state}.${codeVerifier}`,
    cookieOptions(GOOGLE_STATE_DURATION_MS),
  );
  return res.redirect(302, authorizationUrl);
}

export async function googleCallback(req, res) {
  const savedState = getCookie(req, GOOGLE_STATE_COOKIE);
  const suppliedState =
    typeof req.query.state === "string" ? req.query.state : "";
  const separator = savedState?.indexOf(".") ?? -1;
  const expectedState = separator > 0 ? savedState.slice(0, separator) : "";
  const codeVerifier = separator > 0 ? savedState.slice(separator + 1) : "";
  clearGoogleStateCookie(res);

  if (!statesMatch(expectedState, suppliedState) || !codeVerifier) {
    return redirectToLogin(res, "google");
  }

  if (
    typeof req.query.error === "string" ||
    typeof req.query.code !== "string" ||
    !req.query.code
  ) {
    return redirectToLogin(res, "google");
  }

  try {
    const profile = await exchangeGoogleCode(req.query.code, codeVerifier);
    const { user, tokens } = await loginWithGoogle(profile);
    setAuthCookies(res, tokens);
    return res.redirect(303, `${getGoogleFrontendOrigin()}/onboarding`);
  } catch (error) {
    console.error("Google OAuth callback failed:", error);
    return redirectToLogin(
      res,
      error instanceof AuthServiceError &&
        error.code === "GOOGLE_OAUTH_NOT_CONFIGURED"
        ? "google-unavailable"
        : "google",
    );
  }
}

export async function refresh(req, res) {
  try {
    const { accessToken } = await refreshSession(getCookie(req, REFRESH_COOKIE));
    res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_TOKEN_DURATION_MS));
    return res.status(200).json({ success: true, data: {} });
  } catch (error) {
    if (error instanceof AuthServiceError && error.code === "INVALID_REFRESH_TOKEN") {
      clearAuthCookies(res);
    }
    throw error;
  }
}

export async function logout(req, res) {
  await logoutSession(getCookie(req, REFRESH_COOKIE));
  clearAuthCookies(res);
  return res.status(200).json({ success: true, data: {} });
}

function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_TOKEN_DURATION_MS));
  res.cookie(
    REFRESH_COOKIE,
    refreshToken,
    cookieOptions(REFRESH_TOKEN_DURATION_MS, "/api/auth"),
  );
}

function cookieOptions(maxAge, path = "/") {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path,
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, cookieOptions(undefined));
  res.clearCookie(REFRESH_COOKIE, cookieOptions(undefined, "/api/auth"));
}

function clearGoogleStateCookie(res) {
  res.clearCookie(GOOGLE_STATE_COOKIE, cookieOptions(undefined));
}

function redirectToLogin(res, error) {
  const loginUrl = new URL("/login", getGoogleFrontendOrigin());
  loginUrl.searchParams.set("oauthError", error);
  return res.redirect(303, loginUrl.toString());
}

function statesMatch(expected, supplied) {
  if (!expected || !supplied) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

function getCookie(req, name) {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!cookie) {
    return null;
  }

  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return null;
  }
}
