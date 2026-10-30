import {
  AuthServiceError,
  loginUser,
  logoutSession,
  refreshSession,
  registerUser,
} from "../services/authService.js";
import { deleteImage, uploadImage } from "../services/cloudinaryService.js";

const ACCESS_COOKIE = "propertydek_access";
const REFRESH_COOKIE = "propertydek_refresh";
const ACCESS_TOKEN_DURATION_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

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
