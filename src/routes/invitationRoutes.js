import { Router } from "express";
import {
  acceptInvitation,
  cancelInvitation,
  createInvitations,
  listInvitations,
} from "../controllers/invitationController.js";

const router = Router();

router.get("/organizations/:organizationId/invitations", listInvitations);
router.post("/organizations/:organizationId/invitations", createInvitations);
router.delete(
  "/organizations/:organizationId/invitations/:invitationId",
  cancelInvitation,
);
router.post("/invitations/accept", acceptInvitation);

export default router;
