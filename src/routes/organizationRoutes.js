import { Router } from "express";
import {
  createOrganization,
  getCurrentOrganization,
  updateOrganization,
} from "../controllers/organizationController.js";

const router = Router();

router.post("/organizations", createOrganization);
router.get("/organizations/current", getCurrentOrganization);
router.patch("/organizations/:organizationId", updateOrganization);

export default router;
