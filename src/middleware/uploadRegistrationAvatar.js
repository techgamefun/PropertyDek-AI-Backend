import multer from "multer";
import { ApiError } from "../services/apiError.js";

const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const allowedAvatarTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const parseAvatar = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AVATAR_SIZE_BYTES,
    files: 1,
    fields: 4,
    parts: 5,
    fieldSize: 64 * 1024,
  },
  fileFilter(req, file, callback) {
    if (!allowedAvatarTypes.has(file.mimetype)) {
      callback(
        new ApiError(
          "INVALID_AVATAR_TYPE",
          400,
          "Profile photos must be JPG, PNG, or WebP images.",
          { avatar: "Choose a JPG, PNG, or WebP image." },
        ),
      );
      return;
    }

    callback(null, true);
  },
}).single("avatar");

export function uploadRegistrationAvatar(req, res, next) {
  parseAvatar(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      next(
        new ApiError(
          tooLarge ? "AVATAR_TOO_LARGE" : "INVALID_AVATAR_UPLOAD",
          tooLarge ? 413 : 400,
          tooLarge
            ? "Profile photos must be 5 MB or smaller."
            : "The profile photo upload is invalid.",
          {
            avatar: tooLarge
              ? "Choose an image that is 5 MB or smaller."
              : "Upload one profile photo using the avatar field.",
          },
        ),
      );
      return;
    }

    next(error);
  });
}
