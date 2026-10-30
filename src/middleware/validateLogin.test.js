import { describe, expect, it, vi } from "vitest";
import { validateLogin } from "./validateLogin.js";

function runValidation(body) {
  const req = { body };
  const res = {
    locals: {},
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();

  validateLogin(req, res, next);

  return { req, res, next };
}

describe("validateLogin", () => {
  it("normalizes the email and passes valid credentials to the route", () => {
    const { res, next } = runValidation({
      email: "  Samir@Example.com ",
      password: "correct horse battery staple",
    });

    expect(res.locals.credentials).toEqual({
      email: "samir@example.com",
      password: "correct horse battery staple",
    });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns field errors for malformed credentials", () => {
    const { res, next } = runValidation({
      email: "not-an-email",
      password: "",
    });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        fields: {
          email: "Enter a valid email address of 320 characters or fewer.",
          password: "Password is required.",
        },
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects non-object bodies and passwords over bcrypt's byte limit", () => {
    expect(runValidation([]).res.status).toHaveBeenCalledWith(400);

    const { res, next } = runValidation({
      email: "samir@example.com",
      password: "é".repeat(37),
    });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          fields: {
            password: "Password must be no more than 72 UTF-8 bytes.",
          },
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
