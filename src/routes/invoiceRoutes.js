import { Router } from "express";
import {
  createInvoice,
  getInvoice,
  getInvoiceOptions,
  listInvoices,
  recordInvoicePayment,
  refundInvoicePayment,
  updateInvoice,
} from "../controllers/invoiceController.js";

const router = Router();

router.get("/invoices", listInvoices);
router.get("/invoices/options", getInvoiceOptions);
router.post("/invoices", createInvoice);
router.get("/invoices/:invoiceId", getInvoice);
router.patch("/invoices/:invoiceId", updateInvoice);
router.post("/invoices/:invoiceId/payments", recordInvoicePayment);
router.post(
  "/invoices/:invoiceId/payments/:paymentId/refund",
  refundInvoicePayment,
);

export default router;
