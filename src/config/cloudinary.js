import { v2 as cloudinary } from "cloudinary";

export function getCloudinaryClient() {
  const config = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  };
  const missingVariables = Object.entries({
    CLOUDINARY_CLOUD_NAME: config.cloud_name,
    CLOUDINARY_API_KEY: config.api_key,
    CLOUDINARY_API_SECRET: config.api_secret,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required Cloudinary environment variables: ${missingVariables.join(", ")}`,
    );
  }

  cloudinary.config(config);
  return cloudinary;
}
