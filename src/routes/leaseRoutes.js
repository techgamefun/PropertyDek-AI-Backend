import { Router } from "express";
import {
  createLease,
  deleteLeaseDocument,
  downloadLeaseDocument,
  getLease,
  getLeaseOptions,
  listLeases,
  updateLease,
  uploadLeaseDocument,
} from "../controllers/leaseController.js";
import { uploadLeaseFile } from "../middleware/uploadLeaseFile.js";

const router = Router();

router.get("/leases", listLeases);
router.get("/leases/options", getLeaseOptions);
router.post("/leases", createLease);
router.get("/leases/:leaseId", getLease);
router.patch("/leases/:leaseId", updateLease);
router.post("/leases/:leaseId/documents", uploadLeaseFile, uploadLeaseDocument);
router.get(
  "/leases/:leaseId/documents/:documentId/download",
  downloadLeaseDocument,
);
router.delete(
  "/leases/:leaseId/documents/:documentId",
  deleteLeaseDocument,
);

export default router;
