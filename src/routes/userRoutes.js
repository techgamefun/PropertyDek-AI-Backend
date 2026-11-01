import { Router } from "express";
import {
  getCurrentUser,
  removeCurrentUserAvatar,
  updateCurrentUser,
} from "../controllers/userController.js";
import { uploadProfileAvatar } from "../middleware/uploadRegistrationAvatar.js";

const router = Router();

router.get("/users/me", getCurrentUser);
router.patch("/users/me", uploadProfileAvatar, updateCurrentUser);
router.delete("/users/me/avatar", removeCurrentUserAvatar);

export default router;
