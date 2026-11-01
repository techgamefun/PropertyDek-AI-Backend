import { Router } from "express";
import {
  createTenant,
  deleteTenant,
  getTenant,
  listTenants,
  updateTenant,
} from "../controllers/tenantController.js";
import { uploadProfileAvatar } from "../middleware/uploadRegistrationAvatar.js";

const router = Router();

router.get("/tenants", listTenants);
router.post("/tenants", uploadProfileAvatar, createTenant);
router.get("/tenants/:tenantId", getTenant);
router.patch("/tenants/:tenantId", uploadProfileAvatar, updateTenant);
router.delete("/tenants/:tenantId", deleteTenant);

export default router;
