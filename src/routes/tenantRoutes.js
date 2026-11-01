import { Router } from "express";
import {
  createTenant,
  deleteTenant,
  getTenant,
  listTenants,
  updateTenant,
} from "../controllers/tenantController.js";

const router = Router();

router.get("/tenants", listTenants);
router.post("/tenants", createTenant);
router.get("/tenants/:tenantId", getTenant);
router.patch("/tenants/:tenantId", updateTenant);
router.delete("/tenants/:tenantId", deleteTenant);

export default router;
