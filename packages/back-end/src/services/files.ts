import path from "path";
import fs from "fs";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { Storage } from "@google-cloud/storage";
import {
  S3_BUCKET,
  S3_REGION,
  S3_DOMAIN,
  UPLOAD_METHOD,
  GCS_BUCKET_NAME,
  GCS_DOMAIN,
  AWS_ASSUME_ROLE,
} from "back-end/src/util/secrets";

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
      region: S3_REGION,
    };

    if (AWS_ASSUME_ROLE) {
      clientConfig.credentials = fromTemporaryCredentials({
        params: {
          RoleArn: AWS_ASSUME_ROLE,
          RoleSessionName: "growthbook-uploads",
        },
      });
    }

    s3Client = new S3Client(clientConfig);
  }
  return s3Client;
}

export function getUploadsDir() {
  return path.join(__dirname, "..", "..", "uploads");
}

export async function uploadFile(
  filePath: string,
  contentType: string,
  contents: Buffer,
) {
  // Watch out for poison null bytes
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("Error: Filename must not contain null bytes");
  }

  let fileURL = "";

  if (UPLOAD_METHOD === "s3") {
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: filePath,
        Body: contents,
        ContentType: contentType,
      }),
    );
    fileURL = S3_DOMAIN + (S3_DOMAIN.endsWith("/") ? "" : "/") + filePath;
  } else if (UPLOAD_METHOD === "google-cloud") {
    const storage = new Storage();

    await storage
      .bucket(GCS_BUCKET_NAME)
      .file(filePath)
      .save(contents, { contentType: contentType });
    fileURL = GCS_DOMAIN + (GCS_DOMAIN.endsWith("/") ? "" : "/") + filePath;
  } else {
    const rootDirectory = getUploadsDir();
    const fullPath = path.join(rootDirectory, filePath);

    // Prevent directory traversal
    if (fullPath.indexOf(rootDirectory) !== 0) {
      throw new Error(
        "Error: Path must not escape out of the 'uploads' directory.",
      );
    }

    const dir = path.dirname(fullPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(fullPath, contents);
    fileURL = `/upload/${filePath}`;
  }
  return fileURL;
}

export function getImageData(filePath: string) {
  // Watch out for poison null bytes
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("Error: Filename must not contain null bytes");
  }

  const rootDirectory = getUploadsDir();
  const fullPath = path.join(rootDirectory, filePath);

  // Prevent directory traversal
  if (fullPath.indexOf(rootDirectory) !== 0) {
    throw new Error(
      "Error: Path must not escape out of the 'uploads' directory.",
    );
  }

  if (!fs.existsSync(fullPath)) {
    throw new Error("File not found");
  }

  return fs.createReadStream(fullPath);
}

export async function getSignedImageUrl(
  filePath: string,
  expiresInMinutes: number = 15,
): Promise<string> {
  // Watch out for poison null bytes
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("Error: Filename must not contain null bytes");
  }

  // Extract the object key from a full URL if necessary
  let objectKey = filePath;
  try {
    const url = new URL(filePath);
    objectKey = url.pathname;
    // Remove leading slash if present
    if (objectKey.startsWith("/")) {
      objectKey = objectKey.substring(1);
    }
    // Remove /upload/ prefix if present (for local uploads)
    if (objectKey.startsWith("upload/")) {
      objectKey = objectKey.substring(7);
    }
  } catch {
    // Not a full URL, use as-is
  }

  if (UPLOAD_METHOD === "s3") {
    const client = getS3Client();
    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: objectKey,
      }),
      { expiresIn: expiresInMinutes * 60 },
    );
  } else if (UPLOAD_METHOD === "google-cloud") {
    const storage = new Storage();
    const bucket = storage.bucket(GCS_BUCKET_NAME);
    const file = bucket.file(objectKey);

    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + expiresInMinutes * 60 * 1000,
    });

    return signedUrl;
  } else {
    throw new Error(
      "Signed upload URLs are only supported for S3 and Google Cloud Storage",
    );
  }
}

export async function getSignedUploadUrl(
  filePath: string,
  contentType: string,
  expiresInMinutes: number = 15,
): Promise<{
  signedUrl: string;
  fileUrl: string;
  fields?: Record<string, string>;
}> {
  // Watch out for poison null bytes
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("Error: Filename must not contain null bytes");
  }

  if (UPLOAD_METHOD === "s3") {
    const client = getS3Client();
    const { url, fields } = await createPresignedPost(client, {
      Bucket: S3_BUCKET,
      Key: filePath,
      Conditions: [
        ["eq", "$Content-Type", contentType],
        ["eq", "$key", filePath],
      ],
      Fields: {
        key: filePath,
        "Content-Type": contentType,
      },
      Expires: expiresInMinutes * 60,
    });

    const fileUrl = S3_DOMAIN + (S3_DOMAIN.endsWith("/") ? "" : "/") + filePath;

    return {
      signedUrl: url,
      fileUrl,
      fields: fields as Record<string, string>,
    };
  } else if (UPLOAD_METHOD === "google-cloud") {
    const storage = new Storage();
    const bucket = storage.bucket(GCS_BUCKET_NAME);
    const file = bucket.file(filePath);

    // GCS will reject uploads if the Content-Type header doesn't match exactly
    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + expiresInMinutes * 60 * 1000,
      contentType,
    });

    const fileUrl =
      GCS_DOMAIN + (GCS_DOMAIN.endsWith("/") ? "" : "/") + filePath;

    return { signedUrl, fileUrl };
  } else {
    throw new Error(
      "Signed upload URLs are only supported for S3 and Google Cloud Storage",
    );
  }
}
