import { Router } from "express";
import {
  getCurrentUser,
  updateCurrentUser,
} from "../controllers/userController.js";

const router = Router();

router.get("/users/me", getCurrentUser);
router.patch("/users/me", updateCurrentUser);

export default router;
