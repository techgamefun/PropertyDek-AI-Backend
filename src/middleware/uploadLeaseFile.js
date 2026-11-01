import multer from "multer";
import { ApiError } from "../services/apiError.js";

const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024;
const allowedDocumentTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);

function createDocumentUpload(ownerLabel, allowAnyFile = false) {
  const parseDocument = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_DOCUMENT_SIZE_BYTES,
      files: 1,
      fields: 0,
      parts: 1,
    },
    fileFilter(req, file, callback) {
      if (!allowAnyFile && !allowedDocumentTypes.has(file.mimetype)) {
        callback(
          new ApiError(
            "INVALID_DOCUMENT_TYPE",
            400,
            `${ownerLabel} documents must be PDF, DOC, DOCX, JPG, or PNG files.`,
          ),
        );
        return;
      }
      callback(null, true);
    },
  }).single("document");

  return function uploadDocument(req, res, next) {
    parseDocument(req, res, (error) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof multer.MulterError) {
        const tooLarge = error.code === "LIMIT_FILE_SIZE";
        next(
          new ApiError(
            tooLarge ? "DOCUMENT_TOO_LARGE" : "INVALID_DOCUMENT_UPLOAD",
            tooLarge ? 413 : 400,
            tooLarge
              ? `${ownerLabel} documents must be 15 MB or smaller.`
              : `Upload one ${ownerLabel.toLowerCase()} document using the document field.`,
          ),
        );
        return;
      }
      next(error);
    });
  };
}

export const uploadLeaseFile = createDocumentUpload("Lease");
export const uploadMaintenanceFile = createDocumentUpload("Maintenance");
export const uploadPropertyFile = createDocumentUpload("Property", true);
