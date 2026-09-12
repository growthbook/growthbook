const mockGcsDelete = jest.fn();
const mockGcsFile = jest.fn(() => ({ delete: mockGcsDelete }));
const mockGcsBucket = jest.fn(() => ({ file: mockGcsFile }));

jest.mock("back-end/src/util/secrets", () => ({
  S3_BUCKET: "private-s3-bucket",
  S3_REGION: "us-west-2",
  S3_DOMAIN: "https://s3.example.com/",
  S3_ENDPOINT: "",
  UPLOAD_METHOD: "google-cloud",
  GCS_BUCKET_NAME: "private-gcs-bucket",
  GCS_DOMAIN: "https://gcs.example.com/",
  AWS_ASSUME_ROLE: "",
  S3_SESSION_REPLAY_BUCKET: "",
  S3_SESSION_REPLAY_BUCKET_EU: "",
  S3_SESSION_REPLAY_ASSUME_ROLE: "",
  VISUAL_EDITOR_ASSETS_S3_BUCKET: "public-s3-bucket",
  VISUAL_EDITOR_ASSETS_S3_REGION: "us-east-1",
  VISUAL_EDITOR_ASSETS_S3_DOMAIN: "https://public-s3.example.com/",
  VISUAL_EDITOR_ASSETS_GCS_BUCKET_NAME: "public-gcs-bucket",
  VISUAL_EDITOR_ASSETS_GCS_DOMAIN: "https://public-gcs.example.com/",
}));
jest.mock("@google-cloud/storage", () => ({
  Storage: class {
    public bucket = mockGcsBucket;
  },
}));
jest.mock("back-end/src/util/logger", () => ({
  logger: { error: jest.fn() },
}));

import { deleteFile } from "back-end/src/services/files";

describe("deleteFile with Google Cloud Storage", () => {
  it("deletes the object from the configured bucket", async () => {
    const key =
      "org_test/2026-09/img_123e4567-e89b-12d3-a456-426614174000.jpeg";
    mockGcsDelete.mockResolvedValueOnce([]);

    await deleteFile(key);

    expect(mockGcsBucket).toHaveBeenCalledWith("private-gcs-bucket");
    expect(mockGcsFile).toHaveBeenCalledWith(key);
    expect(mockGcsDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});
