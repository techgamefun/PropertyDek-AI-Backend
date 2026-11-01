import { Router } from "express";
import {
  createProperty,
  createUnit,
  createUnitsBulk,
  deletePropertyDocument,
  downloadPropertyDocument,
  getProperty,
  listProperties,
  listUnits,
  uploadPropertyDocument,
  updateProperty,
} from "../controllers/propertyController.js";
import { uploadPropertyFile } from "../middleware/uploadLeaseFile.js";

const router = Router();

router.post("/properties", createProperty);
router.get("/properties", listProperties);
router.post("/properties/:propertyId/units/bulk", createUnitsBulk);
router.post("/properties/:propertyId/units", createUnit);
router.get("/properties/:propertyId/units", listUnits);
router.post(
  "/properties/:propertyId/documents",
  uploadPropertyFile,
  uploadPropertyDocument,
);
router.get(
  "/properties/:propertyId/documents/:documentId/download",
  downloadPropertyDocument,
);
router.delete(
  "/properties/:propertyId/documents/:documentId",
  deletePropertyDocument,
);
router.get("/properties/:propertyId", getProperty);
router.patch("/properties/:propertyId", updateProperty);

export default router;
