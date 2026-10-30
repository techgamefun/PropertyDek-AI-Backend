import prisma from "../config/prismaClient.js";

export async function checkDatabaseHealth(req, res) {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      success: true,
      message: "Supabase PostgreSQL connected successfully",
    });
  } catch (error) {
    console.error("Database connection error:", error);

    res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
}
