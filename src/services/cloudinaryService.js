import { getCloudinaryClient } from "../config/cloudinary.js";

export function uploadImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new TypeError("uploadImage requires a non-empty image buffer.");
  }

  const cloudinary = getCloudinaryClient();

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "propertydek",
        resource_type: "image",
        unique_filename: true,
        overwrite: false,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (!result?.secure_url || !result.public_id) {
          reject(new Error("Cloudinary returned an incomplete image upload result."));
        } else {
          resolve(result);
        }
      },
    );

    uploadStream.end(buffer);
  });
}

export function deleteImage(publicId) {
  if (typeof publicId !== "string" || publicId.length === 0) {
    throw new TypeError("deleteImage requires a Cloudinary public ID.");
  }

  const cloudinary = getCloudinaryClient();
  return cloudinary.uploader.destroy(publicId, { resource_type: "image" });
}
