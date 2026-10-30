import jwt from "jsonwebtoken";
import { ApiError } from "../services/apiError.js";
import prisma from "../config/prismaClient.js";

const ACCESS_COOKIE = "propertydek_access";

export async function authenticateUser(req, res, next) {
  const token = getAccessToken(req);
  if (!token) {
    return next(
      new ApiError("AUTHENTICATION_REQUIRED", 401, "Please sign in to continue."),
    );
  }

  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    return next(new Error("JWT_SECRET must be configured with at least 32 bytes."));
  }

  let payload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch {
    return next(
      new ApiError("INVALID_SESSION", 401, "Your session has expired. Please sign in again."),
    );
  }

  if (
    typeof payload !== "object" ||
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string" ||
    payload.tokenUse !== "access"
  ) {
    return next(
      new ApiError("INVALID_SESSION", 401, "Your session has expired. Please sign in again."),
    );
  }

  try {
    const session = await prisma.authSession.findUnique({
      where: { id: payload.sid },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      return next(
        new ApiError("INVALID_SESSION", 401, "Your session has expired. Please sign in again."),
      );
    }

    req.authUserId = payload.sub;
    req.authSessionId = session.id;
    return next();
  } catch (error) {
    return next(error);
  }
}

function getAccessToken(req) {
  const authorization = req.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice(7).trim();
  }

  const cookies = req.headers.cookie?.split(";") ?? [];
  const sessionCookie = cookies.find((cookie) =>
    cookie.trim().startsWith(`${ACCESS_COOKIE}=`),
  );
  if (!sessionCookie) {
    return null;
  }

  const value = sessionCookie.trim().slice(ACCESS_COOKIE.length + 1);
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
