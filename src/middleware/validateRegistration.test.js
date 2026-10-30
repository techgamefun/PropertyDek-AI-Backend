import { describe, expect, it, vi } from "vitest";
import { validateRegistration } from "./validateRegistration.js";

function runValidation(body) {
  const req = { body };
  const res = {
    locals: {},
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();

  validateRegistration(req, res, next);

  return { res, next };
}

describe("validateRegistration", () => {
  it("normalizes registration fields and accepts an optional phone number", () => {
    const { res, next } = runValidation({
      fullName: "  Samir Khan ",
      email: "  Samir@Example.com ",
      password: "a secure password",
      phone: "  +1 555 123 4567 ",
    });

    expect(res.locals.registration).toEqual({
      fullName: "Samir Khan",
      email: "samir@example.com",
      password: "a secure password",
      phone: "+1 555 123 4567",
    });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("stores an omitted or empty phone as null", () => {
    const omitted = runValidation({
      fullName: "Samir",
      email: "samir@example.com",
      password: "a secure password",
    });
    const empty = runValidation({
      fullName: "Samir",
      email: "samir@example.com",
      password: "a secure password",
      phone: "  ",
    });

    expect(omitted.res.locals.registration.phone).toBeNull();
    expect(empty.res.locals.registration.phone).toBeNull();
  });

  it("rejects phone numbers with invalid types or excessive length", () => {
    const invalidType = runValidation({
      fullName: "Samir",
      email: "samir@example.com",
      password: "a secure password",
      phone: 123,
    });
    const tooLong = runValidation({
      fullName: "Samir",
      email: "samir@example.com",
      password: "a secure password",
      phone: "1".repeat(41),
    });

    expect(invalidType.res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          fields: { phone: "Phone number must be text." },
        }),
      }),
    );
    expect(tooLong.res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          fields: { phone: "Phone number must be 40 characters or fewer." },
        }),
      }),
    );
    expect(invalidType.next).not.toHaveBeenCalled();
    expect(tooLong.next).not.toHaveBeenCalled();
  });
});
