import { ApiError } from "./apiError.js";

export function requireObject(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("VALIDATION_ERROR", 400, "A JSON object is required.");
  }
  return body;
}

export function requireString(value, fieldName, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("VALIDATION_ERROR", 400, `${fieldName} is required.`, {
      [fieldName]: `${fieldName} is required.`,
    });
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      `${fieldName} must be ${maxLength} characters or fewer.`,
    );
  }
  return normalized;
}

export function optionalString(value, fieldName, maxLength) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  return requireString(value, fieldName, maxLength);
}

export function requireNumber(value, fieldName, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      `${fieldName} must be a number between ${min} and ${max}.`,
    );
  }
  return value;
}

export function requireEnum(value, allowedValues, fieldName) {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      `${fieldName} must be one of: ${allowedValues.join(", ")}.`,
    );
  }
  return value;
}
