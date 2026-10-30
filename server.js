// server.js
import "dotenv/config";
import app from "./app.js";

const PORT = process.env.PORT || 3000;

// 1. Store the running server instance
const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// 2. Define the graceful shutdown function
const gracefulShutdown = (signal) => {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

  // Stop accepting new HTTP requests
  server.close(async () => {
    console.log("HTTP server closed.");

    try {
      // Step 3: Close database or third-party connections here
      // e.g., await mongoose.connection.close();
      // e.g., await redisClient.quit();
      console.log("Database and external service connections closed.");

      console.log("Graceful shutdown completed successfully.");
      process.exit(0); // Clean exit
    } catch (err) {
      console.error("Error during shutdown operations:", err);
      process.exit(1); // Exit with failure code
    }
  });

  // Force exit if shutdown operations take longer than 10 seconds
  setTimeout(() => {
    console.error("Forced shutdown: operations timed out.");
    process.exit(1);
  }, 10000);
};

// 3. Listen for termination signals
// SIGINT = Ctrl + C in terminal
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// SIGTERM = Signal sent by process managers (Docker, Kubernetes, Heroku, PM2)
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// 4. Handle unexpected crashes/errors globally
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("unhandledRejection");
});
