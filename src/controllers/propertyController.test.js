import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentMembership: vi.fn(),
  propertyFindFirst: vi.fn(),
  documentCreate: vi.fn(),
  documentFindFirst: vi.fn(),
  documentDelete: vi.fn(),
  uploadPrivateDocument: vi.fn(),
  getPrivateDocumentDownloadUrl: vi.fn(),
  deletePrivateDocument: vi.fn(),
}));

vi.mock("../config/prismaClient.js", () => ({
  default: {
    property: { findFirst: mocks.propertyFindFirst },
    document: {
      create: mocks.documentCreate,
      findFirst: mocks.documentFindFirst,
      delete: mocks.documentDelete,
    },
  },
}));

vi.mock("../services/organizationAccess.js", () => ({
  requireCurrentMembership: mocks.requireCurrentMembership,
  requireUuid: (value) => value,
}));

vi.mock("../services/cloudinaryService.js", () => ({
  deletePrivateDocument: mocks.deletePrivateDocument,
  getPrivateDocumentDownloadUrl: mocks.getPrivateDocumentDownloadUrl,
  uploadPrivateDocument: mocks.uploadPrivateDocument,
}));

import {
  deletePropertyDocument,
  downloadPropertyDocument,
  getProperty,
  uploadPropertyDocument,
} from "./propertyController.js";

describe("property document handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentMembership.mockResolvedValue({
      organizationId: "org-123",
      role: "OWNER",
    });
    mocks.propertyFindFirst.mockResolvedValue({ id: "property-123" });
    mocks.uploadPrivateDocument.mockResolvedValue({ public_id: "private/document" });
    mocks.documentCreate.mockResolvedValue({
      id: "document-123",
      name: "inspection.pdf",
      mimeType: "application/pdf",
      sizeBytes: 123n,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      uploadedBy: { id: "user-123", fullName: "Jordan Lee" },
    });
    mocks.documentFindFirst.mockResolvedValue({
      id: "document-123",
      storagePath: "private/document",
      name: "inspection.pdf",
    });
    mocks.getPrivateDocumentDownloadUrl.mockReturnValue("https://example.test/download");
    mocks.deletePrivateDocument.mockResolvedValue({ result: "ok" });
    mocks.documentDelete.mockResolvedValue({});
  });

  it("uploads a supported document for a property in the current workspace", async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await uploadPropertyDocument(
      {
        authUserId: "user-123",
        params: { propertyId: "property-123" },
        file: {
          originalname: "inspection.pdf",
          mimetype: "application/pdf",
          buffer: Buffer.from("document"),
          size: 8,
        },
      },
      res,
    );

    expect(mocks.propertyFindFirst).toHaveBeenCalledWith({
      where: { id: "property-123", organizationId: "org-123" },
      select: { id: true },
    });

    expect(mocks.documentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-123",
          uploadedById: "user-123",
          propertyId: "property-123",
          storagePath: "private/document",
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          document: expect.objectContaining({ sizeBytes: "123" }),
        },
      }),
    );
  });

  it("accepts other file types imported from Google Drive", async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await uploadPropertyDocument(
      {
        authUserId: "user-123",
        params: { propertyId: "property-123" },
        file: {
          originalname: "property-data.xlsx",
          mimetype:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from("spreadsheet"),
          size: 11,
        },
      },
      res,
    );

    expect(mocks.uploadPrivateDocument).toHaveBeenCalledWith(
      Buffer.from("spreadsheet"),
      "property-data.xlsx",
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("includes property documents in the property detail response", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    mocks.propertyFindFirst.mockResolvedValue({
      id: "property-123",
      units: [],
      documents: [
        {
          id: "document-123",
          name: "inspection.pdf",
          mimeType: "application/pdf",
          sizeBytes: 123n,
          createdAt,
          uploadedBy: { id: "user-123", fullName: "Jordan Lee" },
        },
      ],
    });
    const res = { json: vi.fn().mockReturnThis() };

    await getProperty(
      {
        authUserId: "user-123",
        params: { propertyId: "property-123" },
      },
      res,
    );

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        property: expect.objectContaining({
          documents: [
            expect.objectContaining({
              id: "document-123",
              sizeBytes: "123",
              uploadedBy: { id: "user-123", fullName: "Jordan Lee" },
            }),
          ],
        }),
      },
    });
  });

  it("rejects documents whose extension does not match their MIME type", async () => {
    await expect(
      uploadPropertyDocument(
        {
          authUserId: "user-123",
          params: { propertyId: "property-123" },
          file: {
            originalname: "inspection.png",
            mimetype: "application/pdf",
            buffer: Buffer.from("document"),
            size: 8,
          },
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "INVALID_DOCUMENT_TYPE" });
    expect(mocks.uploadPrivateDocument).not.toHaveBeenCalled();
  });

  it("issues downloads only for documents belonging to the current workspace and property", async () => {
    const res = { json: vi.fn().mockReturnThis() };
    await downloadPropertyDocument(
      {
        authUserId: "user-123",
        params: { propertyId: "property-123", documentId: "document-123" },
      },
      res,
    );

    expect(mocks.documentFindFirst).toHaveBeenCalledWith({
      where: {
        id: "document-123",
        propertyId: "property-123",
        organizationId: "org-123",
      },
      select: { storagePath: true, name: true },
    });
    expect(mocks.getPrivateDocumentDownloadUrl).toHaveBeenCalledWith(
      "private/document",
      "pdf",
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { downloadUrl: "https://example.test/download" },
    });
  });

  it("deletes the private asset and its workspace-scoped record", async () => {
    const res = { json: vi.fn().mockReturnThis() };
    await deletePropertyDocument(
      {
        authUserId: "user-123",
        params: { propertyId: "property-123", documentId: "document-123" },
      },
      res,
    );

    expect(mocks.deletePrivateDocument).toHaveBeenCalledWith("private/document");
    expect(mocks.documentDelete).toHaveBeenCalledWith({
      where: { id: "document-123" },
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { deleted: true },
    });
  });
});
