// app.js
import express from "express";

const app = express();

// Middleware
app.use(express.json());

// Routes
app.get("/", (req, res) => {
  res.send("Hello, Express and Git with separated app and server!");
});

// Export the express app instance
export default app;
