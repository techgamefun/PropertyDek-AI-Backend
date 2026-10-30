const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_BCRYPT_PASSWORD_BYTES = 72;

export function validateRegistration(req, res, next) {
  const body = req.body;
  const fields = {};

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return sendValidationError(res, {
      body: "A JSON object is required.",
    });
  }

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!fullName) {
    fields.fullName = "Full name is required.";
  } else if (fullName.length > 160) {
    fields.fullName = "Full name must be 160 characters or fewer.";
  }

  if (!email) {
    fields.email = "Email is required.";
  } else if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    fields.email = "Enter a valid email address of 320 characters or fewer.";
  }

  if (!password) {
    fields.password = "Password is required.";
  } else if ([...password].length < 12) {
    fields.password = "Password must be at least 12 characters.";
  } else if (Buffer.byteLength(password, "utf8") > MAX_BCRYPT_PASSWORD_BYTES) {
    fields.password = "Password must be no more than 72 UTF-8 bytes.";
  }

  if (Object.keys(fields).length > 0) {
    return sendValidationError(res, fields);
  }

  res.locals.registration = { fullName, email, password };
  return next();
}

function sendValidationError(res, fields) {
  return res.status(400).json({
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      fields,
    },
  });
}
