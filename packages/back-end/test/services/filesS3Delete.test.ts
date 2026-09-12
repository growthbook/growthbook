const mockS3Send = jest.fn();

jest.mock("back-end/src/util/secrets", () => ({
  S3_BUCKET: "private-s3-bucket",
  S3_REGION: "us-west-2",
  S3_DOMAIN: "https://s3.example.com/",
  S3_ENDPOINT: "",
  UPLOAD_METHOD: "s3",
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
jest.mock("@aws-sdk/client-s3", () => {
  class Command {}
  class DeleteObjectCommand {
    public input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }
  class S3Client {
    public send = mockS3Send;
  }

  return {
    S3Client,
    PutObjectCommand: Command,
    GetObjectCommand: Command,
    ListObjectsV2Command: Command,
    CopyObjectCommand: Command,
    DeleteObjectCommand,
    HeadObjectCommand: Command,
  };
});
jest.mock("back-end/src/util/logger", () => ({
  logger: { error: jest.fn() },
}));

import { deleteFile } from "back-end/src/services/files";

describe("deleteFile with S3 storage", () => {
  it("deletes the object from the configured bucket", async () => {
    const key =
      "org_test/2026-09/img_123e4567-e89b-12d3-a456-426614174000.jpeg";
    mockS3Send.mockResolvedValueOnce({});

    await deleteFile(key);

    const command = mockS3Send.mock.calls[0]?.[0] as {
      input: { Bucket: string; Key: string };
    };
    expect(command.input).toEqual({
      Bucket: "private-s3-bucket",
      Key: key,
    });
  });
});
