import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./src/controllers/authController.js", () => ({
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  googleLogin: vi.fn(),
  googleCallback: (_req, res) => res.status(200).send("Google callback reached"),
}));
vi.mock("./src/routes/apiRoutes.js", () => ({
  default: (_req, _res, next) => next(),
}));
vi.mock("./src/controllers/healthController.js", () => ({
  checkDatabaseHealth: vi.fn(),
}));
vi.mock("./src/middleware/errorHandler.js", () => ({
  errorHandler: (error, _req, res, _next) =>
    res.status(500).send(error.message),
}));

import app from "./app.js";

describe("Google OAuth callback routes", () => {
  let server;

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = undefined;
    }
  });

  it.each([
    "/auth/google/callback",
    "/api/auth/google/callback",
  ])("handles GET %s", async (path) => {
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();

    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("Google callback reached");
  });
});
