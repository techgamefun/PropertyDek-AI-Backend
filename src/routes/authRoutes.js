import { Router } from "express";
import {
  googleCallback,
  googleLogin,
  login,
  logout,
  refresh,
  register,
} from "../controllers/authController.js";
import { validateLogin } from "../middleware/validateLogin.js";
import { validateRegistration } from "../middleware/validateRegistration.js";
import { uploadRegistrationAvatar } from "../middleware/uploadRegistrationAvatar.js";

const router = Router();

router.post("/register", uploadRegistrationAvatar, validateRegistration, register);
router.post("/login", validateLogin, login);
router.get("/google", googleLogin);
router.get("/google/callback", googleCallback);
router.post("/refresh", refresh);
router.post("/logout", logout);

export default router;
