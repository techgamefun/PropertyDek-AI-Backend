import { Router } from "express";
import {
  addMaintenanceComment,
  assignTechnician,
  createMaintenanceRequest,
  createTechnician,
  deleteMaintenanceDocument,
  downloadMaintenanceDocument,
  getMaintenanceOptions,
  getMaintenanceRequest,
  listMaintenanceRequests,
  unassignTechnician,
  uploadMaintenanceDocument,
  updateMaintenanceRequest,
} from "../controllers/maintenanceController.js";
import { uploadMaintenanceFile } from "../middleware/uploadLeaseFile.js";

const router = Router();

router.get("/maintenance", listMaintenanceRequests);
router.get("/maintenance/options", getMaintenanceOptions);
router.post("/maintenance", createMaintenanceRequest);
router.post("/maintenance/technicians", createTechnician);
router.get("/maintenance/:requestId", getMaintenanceRequest);
router.patch("/maintenance/:requestId", updateMaintenanceRequest);
router.post("/maintenance/:requestId/comments", addMaintenanceComment);
router.post("/maintenance/:requestId/assignments", assignTechnician);
router.delete("/maintenance/:requestId/assignments/:assignmentId", unassignTechnician);
router.post(
  "/maintenance/:requestId/documents",
  uploadMaintenanceFile,
  uploadMaintenanceDocument,
);
router.get(
  "/maintenance/:requestId/documents/:documentId/download",
  downloadMaintenanceDocument,
);
router.delete(
  "/maintenance/:requestId/documents/:documentId",
  deleteMaintenanceDocument,
);

export default router;
