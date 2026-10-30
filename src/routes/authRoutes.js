import { Router } from "express";
import { register } from "../controllers/authController.js";
import { validateRegistration } from "../middleware/validateRegistration.js";

const router = Router();

router.post("/register", validateRegistration, register);

export default router;
