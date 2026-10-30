// app.js
import express from "express";
import { checkDatabaseHealth } from "./src/controllers/healthController.js";

const app = express();

// Middleware
app.use(express.json());

// Routes
app.get("/", (req, res) => {
  res.send("Hello, Express and Git with separated app and server!");
});

// Database health check
app.get("/api/health/database", checkDatabaseHealth);

// Export the express app instance
export default app;
