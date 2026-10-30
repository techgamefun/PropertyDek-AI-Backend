// app.js
import express from "express";
import authRoutes from "./src/routes/authRoutes.js";
import { checkDatabaseHealth } from "./src/controllers/healthController.js";
import { errorHandler } from "./src/middleware/errorHandler.js";

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.send("Hello, Express and Git with separated app and server!");
});

// Database health check
app.get("/api/health/database", checkDatabaseHealth);

// Keep error responses sanitized, including unexpected database errors.
app.use(errorHandler);

// Export the express app instance
export default app;
