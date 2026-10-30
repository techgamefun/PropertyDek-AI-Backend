import bcrypt from "bcrypt";
import prisma from "../config/prismaClient.js";

const BCRYPT_ROUNDS = 12;

export class AuthServiceError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = "AuthServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function registerUser({ fullName, email, password }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    return await prisma.user.create({
      data: { fullName, email, passwordHash },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
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
