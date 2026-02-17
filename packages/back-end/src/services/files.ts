import path from "path";
import fs from "fs";
import AWS from "aws-sdk";
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

let s3: AWS.S3;
let awsTempCredentials: AWS.TemporaryCredentials | null = null;

async function getS3(): Promise<AWS.S3> {
  if (!s3) {
    AWS.config.update({ region: S3_REGION });
    if (AWS_ASSUME_ROLE) {
      // Use TemporaryCredentials so the SDK will automatically refresh
      // STS credentials when they expire instead of fetching them once.
      awsTempCredentials = new AWS.TemporaryCredentials({
        RoleArn: AWS_ASSUME_ROLE,
        RoleSessionName: "growthbook-uploads",
      });

      s3 = new AWS.S3({
        signatureVersion: "v4",
        credentials: awsTempCredentials,
      });
    } else {
      s3 = new AWS.S3({ signatureVersion: "v4" });
    }
  }
  // Eagerly refresh expired/expiring credentials before returning the client.
  // This ensures even synchronous operations like getSignedUrl use valid creds.
  if (awsTempCredentials && awsTempCredentials.needsRefresh()) {
    await new Promise<void>((resolve, reject) => {
      awsTempCredentials!.refresh((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  return s3;
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
    const params = {
      Bucket: S3_BUCKET,
      Key: filePath,
      Body: contents,
      ContentType: contentType,
    };
    const s3Client = await getS3();
    await s3Client.upload(params).promise();
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
    const params = {
      Bucket: S3_BUCKET,
      Key: objectKey,
      Expires: expiresInMinutes * 60, // Convert to seconds
    };

    const s3Client = await getS3();
    return s3Client.getSignedUrl("getObject", params);
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
    const s3Client = await getS3();

    // Use createPresignedPost for uploads
    const params = {
      Bucket: S3_BUCKET,
      Fields: {
        key: filePath,
        "Content-Type": contentType,
      },
      Expires: expiresInMinutes * 60, // Convert to seconds
      Conditions: [
        // ["content-length-range", 0, 5242880], // Max 5MB file size
        ["eq", "$Content-Type", contentType], // Enforce exact content-type match
        ["eq", "$key", filePath], // Enforce exact key match
      ],
    };

    const postData = await new Promise<{
      url: string;
      fields: Record<string, string>;
    }>((resolve, reject) => {
      s3Client.createPresignedPost(params, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const fileUrl = S3_DOMAIN + (S3_DOMAIN.endsWith("/") ? "" : "/") + filePath;

    return {
      signedUrl: postData.url,
      fileUrl,
      fields: postData.fields,
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
