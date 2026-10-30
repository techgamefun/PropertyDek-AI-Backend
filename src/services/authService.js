import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import prisma from "../config/prismaClient.js";

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_DURATION_SECONDS = 15 * 60;
const REFRESH_TOKEN_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH =
  "$2b$12$/Vgkm4EH7.4BsMMv80Qzy.w/ioZ0aRfebLS6LUl2flQbKiaoyX3tq";

export class AuthServiceError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = "AuthServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function registerUser({
  fullName,
  email,
  password,
  phone = null,
  avatarUrl = null,
}) {
  const secret = getJwtSecret();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    const user = await prisma.user.create({
      data: { fullName, email, passwordHash, phone, avatarUrl },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
    return { user, tokens: await createSessionTokens(user, secret) };
  } catch (error) {
    if (error?.code === "P2002") {
      throw new AuthServiceError(
        "EMAIL_ALREADY_REGISTERED",
        409,
        "An account with this email already exists.",
      );
    }

    throw error;
  }
}

export async function loginUser({ email, password }) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      fullName: true,
      passwordHash: true,
      phone: true,
      avatarUrl: true,
      createdAt: true,
    },
  });

  const passwordMatches = await bcrypt.compare(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !user.passwordHash || !passwordMatches) {
    throw new AuthServiceError(
      "INVALID_CREDENTIALS",
      401,
      "Email or password is incorrect.",
    );
  }

  const { passwordHash, ...safeUser } = user;
  return {
    user: safeUser,
    tokens: await createSessionTokens(safeUser, getJwtSecret()),
  };
}

export async function refreshSession(refreshToken) {
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw invalidRefreshToken();
  }

  const session = await prisma.authSession.findUnique({
    where: { refreshTokenHash: hashRefreshToken(refreshToken) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= new Date()
  ) {
    throw invalidRefreshToken();
  }

  return { accessToken: createAccessToken(session.userId, session.id, getJwtSecret()) };
}

export async function logoutSession(refreshToken) {
  if (typeof refreshToken !== "string" || !refreshToken) {
    return;
  }

  await prisma.authSession.updateMany({
    where: {
      refreshTokenHash: hashRefreshToken(refreshToken),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(
      "JWT_SECRET must be configured with at least 32 bytes before authentication can be used.",
    );
  }

  return secret;
}

async function createSessionTokens(user, secret) {
  const refreshToken = randomBytes(32).toString("base64url");
  const session = await prisma.authSession.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_DURATION_MS),
    },
    select: { id: true },
  });

  return {
    accessToken: createAccessToken(user.id, session.id, secret),
    refreshToken,
  };
}

function createAccessToken(userId, sessionId, secret) {
  return jwt.sign({ tokenUse: "access", sid: sessionId }, secret, {
    subject: userId,
    expiresIn: ACCESS_TOKEN_DURATION_SECONDS,
  });
}

function hashRefreshToken(refreshToken) {
  return createHash("sha256").update(refreshToken).digest("hex");
}

function invalidRefreshToken() {
  return new AuthServiceError(
    "INVALID_REFRESH_TOKEN",
    401,
    "Your session has expired. Please sign in again.",
  );
}
