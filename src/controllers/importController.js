import prisma from "../config/prismaClient.js";
import { ApiError } from "../services/apiError.js";
import { requireCurrentMembership, requireUuid } from "../services/organizationAccess.js";
import { requireObject, requireString } from "../services/requestValidation.js";

export async function createImport(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const body = requireObject(req.body);
  const fileName = requireString(body.fileName, "fileName", 255);
  if (!/\.csv$/iu.test(fileName)) {
    throw new ApiError("VALIDATION_ERROR", 400, "fileName must end in .csv.");
  }

  const importJob = await prisma.importJob.create({
    data: {
      organizationId: membership.organizationId,
      createdByUserId: req.authUserId,
      fileName,
      status: "AWAITING_FILE",
      result: {
        message:
          "This import is recorded but not processed. CSV upload and row validation are not enabled yet.",
      },
    },
  });
  return res.status(201).json({
    success: true,
    data: { import: importJob },
  });
}

export async function getImport(req, res) {
  const membership = await requireCurrentMembership(req.authUserId);
  const importId = requireUuid(req.params.importId, "importId");
  const importJob = await prisma.importJob.findFirst({
    where: { id: importId, organizationId: membership.organizationId },
  });
  if (!importJob) {
    throw new ApiError("IMPORT_NOT_FOUND", 404, "Import not found.");
  }
  return res.json({ success: true, data: { import: importJob } });
}
