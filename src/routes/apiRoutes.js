import { Router } from "express";
import dashboardRoutes from "./dashboardRoutes.js";
import importRoutes from "./importRoutes.js";
import invitationRoutes from "./invitationRoutes.js";
import invoiceRoutes from "./invoiceRoutes.js";
import maintenanceRoutes from "./maintenanceRoutes.js";
import leaseRoutes from "./leaseRoutes.js";
import onboardingRoutes from "./onboardingRoutes.js";
import organizationRoutes from "./organizationRoutes.js";
import propertyRoutes from "./propertyRoutes.js";
import tenantRoutes from "./tenantRoutes.js";
import userRoutes from "./userRoutes.js";
import { authenticateUser } from "../middleware/authenticateUser.js";

const router = Router();

router.use(authenticateUser);
router.use(userRoutes);
router.use(organizationRoutes);
router.use(onboardingRoutes);
router.use(propertyRoutes);
router.use(tenantRoutes);
router.use(leaseRoutes);
router.use(invoiceRoutes);
router.use(maintenanceRoutes);
router.use(invitationRoutes);
router.use(importRoutes);
router.use(dashboardRoutes);

export default router;
