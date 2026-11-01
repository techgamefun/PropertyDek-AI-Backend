import prisma from "../config/prismaClient.js";
import { ApiError } from "../services/apiError.js";
import {
  optionalString,
  requireObject,
  requireString,
} from "../services/requestValidation.js";
import {
  deleteImage,
  getCloudinaryImagePublicId,
  uploadImage,
} from "../services/cloudinaryService.js";

const USER_PROFILE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  avatarUrl: true,
  createdAt: true,
  updatedAt: true,
};

export async function getCurrentUser(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.authUserId },
    select: USER_PROFILE_SELECT,
  });

  if (!user) {
    throw new ApiError("USER_NOT_FOUND", 404, "Your user profile could not be found.");
  }

  return res.json({ success: true, data: { user } });
}

export async function updateCurrentUser(req, res) {
  const body = requireObject(req.body);
  const unsupportedFields = Object.keys(body).filter(
    (field) => !["fullName", "phone"].includes(field),
  );
  if (unsupportedFields.length > 0) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "Only fullName and phone can be updated.",
      Object.fromEntries(
        unsupportedFields.map((field) => [field, "This field cannot be updated."]),
      ),
    );
  }

  const data = {};
  if (body.fullName !== undefined) {
    data.fullName = requireString(body.fullName, "fullName", 160);
  }
  if (body.phone !== undefined) {
    data.phone = optionalString(body.phone, "phone", 40);
  }
  if (Object.keys(data).length === 0 && !req.file) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "At least one profile field must be provided.",
    );
  }

  let uploadedAvatar;
  let previousAvatarUrl;
  if (req.file) {
    const previousUser = await prisma.user.findUnique({
      where: { id: req.authUserId },
      select: { avatarUrl: true },
    });
    if (!previousUser) {
      throw new ApiError("USER_NOT_FOUND", 404, "Your user profile could not be found.");
    }
    previousAvatarUrl = previousUser.avatarUrl;
    uploadedAvatar = await uploadImage(req.file.buffer);
    data.avatarUrl = uploadedAvatar.secure_url;
  }

  let user;
  try {
    user = await prisma.user.update({
      where: { id: req.authUserId },
      data,
      select: USER_PROFILE_SELECT,
    });
  } catch (error) {
    if (uploadedAvatar?.public_id) {
      try {
        await deleteImage(uploadedAvatar.public_id);
      } catch (cleanupError) {
        console.error("Failed to remove an unused profile photo:", cleanupError);
      }
    }
    throw error;
  }

  await removePreviousAvatar(previousAvatarUrl);
  return res.json({ success: true, data: { user } });
}

export async function removeCurrentUserAvatar(req, res) {
  const existingUser = await prisma.user.findUnique({
    where: { id: req.authUserId },
    select: { avatarUrl: true },
  });
  if (!existingUser) {
    throw new ApiError("USER_NOT_FOUND", 404, "Your user profile could not be found.");
  }

  const user = await prisma.user.update({
    where: { id: req.authUserId },
    data: { avatarUrl: null },
    select: USER_PROFILE_SELECT,
  });

  await removePreviousAvatar(existingUser.avatarUrl);
  return res.json({ success: true, data: { user } });
}

async function removePreviousAvatar(avatarUrl) {
  const publicId = getCloudinaryImagePublicId(avatarUrl);
  if (!publicId) {
    return;
  }
  try {
    await deleteImage(publicId);
  } catch (error) {
    console.error("Failed to remove an unused Cloudinary profile photo:", error);
  }
}
