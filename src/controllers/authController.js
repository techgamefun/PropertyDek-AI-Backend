import { registerUser } from "../services/authService.js";

export async function register(req, res) {
  const user = await registerUser(res.locals.registration);

  return res.status(201).json({
    success: true,
    data: { user },
  });
}
