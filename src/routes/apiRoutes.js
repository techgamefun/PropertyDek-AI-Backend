import { Router } from "express";
import dashboardRoutes from "./dashboardRoutes.js";
import importRoutes from "./importRoutes.js";
import invitationRoutes from "./invitationRoutes.js";
import onboardingRoutes from "./onboardingRoutes.js";
import organizationRoutes from "./organizationRoutes.js";
import propertyRoutes from "./propertyRoutes.js";
import { authenticateUser } from "../middleware/authenticateUser.js";

const router = Router();

router.use(authenticateUser);
router.use(organizationRoutes);
router.use(onboardingRoutes);
router.use(propertyRoutes);
router.use(invitationRoutes);
router.use(importRoutes);
router.use(dashboardRoutes);

export default router;
