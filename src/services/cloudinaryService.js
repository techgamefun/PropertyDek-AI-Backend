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
        } else if (!result) {
          reject(new Error("Cloudinary returned no upload result."));
        } else {
          resolve(result);
        }
      },
    );

    uploadStream.end(buffer);
  });
}
