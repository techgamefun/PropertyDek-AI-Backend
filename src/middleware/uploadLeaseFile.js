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

const parseLeaseDocument = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT_SIZE_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
  },
  fileFilter(req, file, callback) {
    if (!allowedDocumentTypes.has(file.mimetype)) {
      callback(
        new ApiError(
          "INVALID_DOCUMENT_TYPE",
          400,
          "Lease documents must be PDF, DOC, DOCX, JPG, or PNG files.",
        ),
      );
      return;
    }
    callback(null, true);
  },
}).single("document");

export function uploadLeaseFile(req, res, next) {
  parseLeaseDocument(req, res, (error) => {
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
            ? "Lease documents must be 15 MB or smaller."
            : "Upload one lease document using the document field.",
        ),
      );
      return;
    }
    next(error);
  });
}
