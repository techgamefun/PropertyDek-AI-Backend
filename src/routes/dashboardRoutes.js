import { Router } from "express";
import {
  getDashboardOverview,
  getGettingStarted,
} from "../controllers/dashboardController.js";

const router = Router();

router.get("/dashboard/overview", getDashboardOverview);
router.get("/dashboard/getting-started", getGettingStarted);

export default router;
