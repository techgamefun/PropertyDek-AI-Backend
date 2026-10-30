import { Router } from "express";
import {
  completeOnboarding,
  completeTeamStep,
  createDemoData,
  getOnboardingStatus,
  saveSetupMethod,
} from "../controllers/onboardingController.js";

const router = Router();

router.get("/onboarding/status", getOnboardingStatus);
router.post("/onboarding/setup-method", saveSetupMethod);
router.post("/onboarding/demo-data", createDemoData);
router.post("/onboarding/complete-step", completeTeamStep);
router.post("/onboarding/complete", completeOnboarding);

export default router;
