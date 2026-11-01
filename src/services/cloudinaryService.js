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

export function getCloudinaryImagePublicId(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl) {
    return null;
  }

  let url;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }

  if (url.hostname !== "res.cloudinary.com") {
    return null;
  }

  const uploadPath = "/image/upload/";
  const uploadIndex = url.pathname.indexOf(uploadPath);
  if (uploadIndex === -1) {
    return null;
  }

  const path = url.pathname.slice(uploadIndex + uploadPath.length);
  const segments = path.split("/");
  if (segments[0]?.startsWith("v") && /^v\d+$/u.test(segments[0])) {
    segments.shift();
  }
  const publicId = segments.join("/").replace(/\.[^/.]+$/u, "");
  return publicId || null;
}

export function uploadPrivateDocument(buffer, fileName) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new TypeError("uploadPrivateDocument requires a non-empty buffer.");
  }

  const cloudinary = getCloudinaryClient();
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "propertydek/lease-documents",
        resource_type: "raw",
        type: "authenticated",
        use_filename: true,
        filename_override: fileName,
        unique_filename: true,
        overwrite: false,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (!result?.public_id) {
          reject(new Error("Cloudinary returned an incomplete lease document upload."));
        } else {
          resolve(result);
        }
      },
    );
    uploadStream.end(buffer);
  });
}

export function getPrivateDocumentDownloadUrl(publicId, format) {
  if (typeof publicId !== "string" || !publicId) {
    throw new TypeError("A document public ID is required.");
  }
  if (typeof format !== "string" || !/^[a-z0-9]{1,10}$/iu.test(format)) {
    throw new TypeError("A valid document format is required.");
  }

  return getCloudinaryClient().utils.private_download_url(publicId, format, {
    resource_type: "raw",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
    attachment: true,
  });
}

export async function deletePrivateDocument(publicId) {
  if (typeof publicId !== "string" || !publicId) {
    throw new TypeError("deletePrivateDocument requires a public ID.");
  }
  const result = await getCloudinaryClient().uploader.destroy(publicId, {
    resource_type: "raw",
    type: "authenticated",
  });
  if (result.result !== "ok") {
    throw new Error("Cloudinary did not confirm deletion of the lease document.");
  }
  return result;
}
