import { Router } from "express";
import {
  createProperty,
  createUnit,
  createUnitsBulk,
  getProperty,
  listProperties,
  listUnits,
  updateProperty,
} from "../controllers/propertyController.js";

const router = Router();

router.post("/properties", createProperty);
router.get("/properties", listProperties);
router.post("/properties/:propertyId/units/bulk", createUnitsBulk);
router.post("/properties/:propertyId/units", createUnit);
router.get("/properties/:propertyId/units", listUnits);
router.get("/properties/:propertyId", getProperty);
router.patch("/properties/:propertyId", updateProperty);

export default router;
