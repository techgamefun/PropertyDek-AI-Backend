import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  uploadImage: vi.fn(),
  deleteImage: vi.fn(),
  getCloudinaryImagePublicId: vi.fn(),
}));

vi.mock("../config/prismaClient.js", () => ({
  default: {
    user: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));

vi.mock("../services/cloudinaryService.js", () => ({
  deleteImage: mocks.deleteImage,
  getCloudinaryImagePublicId: mocks.getCloudinaryImagePublicId,
  uploadImage: mocks.uploadImage,
}));

import {
  getCurrentUser,
  removeCurrentUserAvatar,
  updateCurrentUser,
} from "./userController.js";

describe("user profile controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCloudinaryImagePublicId.mockReturnValue(null);
    mocks.deleteImage.mockResolvedValue({});
  });

  it("returns the authenticated user's safe profile fields", async () => {
    const user = {
      id: "user-123",
      email: "samir@example.com",
      fullName: "Samir",
      phone: null,
      avatarUrl: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    mocks.findUnique.mockResolvedValue(user);
    const res = { json: vi.fn().mockReturnThis() };

    await getCurrentUser({ authUserId: user.id }, res);

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { user },
    });
  });

  it("updates editable profile fields and returns the saved user", async () => {
    const user = {
      id: "user-123",
      email: "samir@example.com",
      fullName: "Samir Patel",
      phone: "+1 555 123 4567",
      avatarUrl: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    };
    mocks.update.mockResolvedValue(user);
    const res = { json: vi.fn().mockReturnThis() };

    await updateCurrentUser(
      {
        authUserId: user.id,
        body: { fullName: "  Samir Patel ", phone: " +1 555 123 4567 " },
      },
      res,
    );

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { fullName: "Samir Patel", phone: "+1 555 123 4567" },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { user },
    });
  });

  it("allows clearing the phone number", async () => {
    mocks.update.mockResolvedValue({ phone: null });
    const res = { json: vi.fn().mockReturnThis() };

    await updateCurrentUser(
      { authUserId: "user-123", body: { phone: "" } },
      res,
    );

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { phone: null } }),
    );
  });

  it("rejects attempts to edit the email address", async () => {
    await expect(
      updateCurrentUser(
        { authUserId: "user-123", body: { email: "new@example.com" } },
        { json: vi.fn() },
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("uploads a new profile photo and removes the previous Cloudinary image", async () => {
    const user = { avatarUrl: "https://res.cloudinary.com/demo/image/upload/old.jpg" };
    mocks.findUnique.mockResolvedValue(user);
    mocks.uploadImage.mockResolvedValue({
      secure_url: "https://res.cloudinary.com/demo/image/upload/new.jpg",
      public_id: "propertydek/new",
    });
    mocks.getCloudinaryImagePublicId.mockReturnValue("propertydek/old");
    mocks.update.mockResolvedValue({ avatarUrl: "https://res.cloudinary.com/demo/image/upload/new.jpg" });
    const res = { json: vi.fn().mockReturnThis() };

    await updateCurrentUser(
      { authUserId: "user-123", body: {}, file: { buffer: Buffer.from("photo") } },
      res,
    );

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { avatarUrl: "https://res.cloudinary.com/demo/image/upload/new.jpg" },
      }),
    );
    expect(mocks.deleteImage).toHaveBeenCalledWith("propertydek/old");
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { user: { avatarUrl: "https://res.cloudinary.com/demo/image/upload/new.jpg" } },
    });
  });

  it("removes the current user's profile photo", async () => {
    mocks.findUnique.mockResolvedValue({
      avatarUrl: "https://res.cloudinary.com/demo/image/upload/profile.jpg",
    });
    mocks.getCloudinaryImagePublicId.mockReturnValue("propertydek/profile");
    const user = { avatarUrl: null };
    mocks.update.mockResolvedValue(user);
    const res = { json: vi.fn().mockReturnThis() };

    await removeCurrentUserAvatar({ authUserId: "user-123" }, res);

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { avatarUrl: null } }),
    );
    expect(mocks.deleteImage).toHaveBeenCalledWith("propertydek/profile");
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { user } });
  });
});
