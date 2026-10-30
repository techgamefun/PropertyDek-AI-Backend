import { Router } from "express";
import { createImport, getImport } from "../controllers/importController.js";

const router = Router();

router.post("/imports", createImport);
router.get("/imports/:importId", getImport);

export default router;
