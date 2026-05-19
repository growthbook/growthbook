import path from "path";
import fs from "fs";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { Storage } from "@google-cloud/storage";
import {
  S3_BUCKET,
  S3_REGION,
  S3_DOMAIN,
  S3_ENDPOINT,
  UPLOAD_METHOD,
  GCS_BUCKET_NAME,
  GCS_DOMAIN,
  AWS_ASSUME_ROLE,
  S3_SESSION_REPLAY_BUCKET,
  S3_SESSION_REPLAY_ASSUME_ROLE,
} from "back-end/src/util/secrets";

/**
 * Builds an S3Client with optional role-assumption and custom-endpoint
 * support. Used to back the per-purpose client caches below.
 */
function buildS3Client({
  assumeRoleArn,
  roleSessionName,
}: {
  assumeRoleArn: string;
  roleSessionName: string;
}): S3Client {
  const clientConfig: S3ClientConfig = {
    region: S3_REGION,
  };

  if (assumeRoleArn) {
    clientConfig.credentials = fromTemporaryCredentials({
      params: {
        RoleArn: assumeRoleArn,
        RoleSessionName: roleSessionName,
      },
    });
  }

  // Custom S3-compatible endpoint (MinIO for local dev, plus R2 / SeaweedFS
  // / etc. for self-hosted users). Path-style addressing is the safe default
  // for these providers; AWS S3 itself doesn't need it.
  if (S3_ENDPOINT) {
    clientConfig.endpoint = S3_ENDPOINT;
    clientConfig.forcePathStyle = true;
  }

  return new S3Client(clientConfig);
}

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = buildS3Client({
      assumeRoleArn: AWS_ASSUME_ROLE,
      roleSessionName: "growthbook-uploads",
    });
  }
  return s3Client;
}

let sessionReplayS3Client: S3Client | null = null;

/**
 * S3 client scoped to the session-replay bucket. May use a different role
 * (via `S3_SESSION_REPLAY_ASSUME_ROLE`) than the uploads client so that read
 * access to replay payloads can be granted independently of write access to
 * the general uploads bucket.
 */
function getSessionReplayS3Client(): S3Client {
  if (!sessionReplayS3Client) {
    sessionReplayS3Client = buildS3Client({
      assumeRoleArn: S3_SESSION_REPLAY_ASSUME_ROLE,
      roleSessionName: "growthbook-session-replay-reads",
    });
  }
  return sessionReplayS3Client;
}

// --- Low-level S3 primitives ---
// Take an explicit client and bucket so they can be reused across the
// uploads bucket (`S3_BUCKET` + `getS3Client()`) and the session-replay
// bucket (`S3_SESSION_REPLAY_BUCKET` + `getSessionReplayS3Client()`).
// Behaviour is identical to what the high-level callers used to do inline.

async function s3GetObjectBuffer(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<Buffer> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!response.Body) throw new Error("Empty S3 response body");
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function s3ListByPrefix(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const response = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  return (response.Contents ?? []).map((obj) => obj.Key ?? "").filter(Boolean);
}

function s3GetSignedReadUrl(
  client: S3Client,
  bucket: string,
  key: string,
  expiresInSec: number,
): Promise<string> {
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSec },
  );
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

export async function listFilesByPrefix(prefix: string): Promise<string[]> {
  if (UPLOAD_METHOD !== "s3") {
    // Local: list files in the uploads directory under the prefix
    const dir = path.join(getUploadsDir(), prefix);
    try {
      const entries = await fs.promises.readdir(dir);
      return entries.map((e) => `${prefix}/${e}`);
    } catch {
      return [];
    }
  }
  return s3ListByPrefix(getS3Client(), S3_BUCKET, prefix);
}

export async function getFileBuffer(filePath: string): Promise<Buffer> {
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("Error: Filename must not contain null bytes");
  }

  if (UPLOAD_METHOD === "s3") {
    return s3GetObjectBuffer(getS3Client(), S3_BUCKET, filePath);
  } else if (UPLOAD_METHOD === "google-cloud") {
    const storage = new Storage();
    const [contents] = await storage
      .bucket(GCS_BUCKET_NAME)
      .file(filePath)
      .download();
    return contents;
  } else {
    const rootDirectory = getUploadsDir();
    const fullPath = path.join(rootDirectory, filePath);
    if (fullPath.indexOf(rootDirectory) !== 0) {
      throw new Error(
        "Error: Path must not escape out of the 'uploads' directory.",
      );
    }
    return fs.promises.readFile(fullPath);
  }
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
    return s3GetSignedReadUrl(
      getS3Client(),
      S3_BUCKET,
      objectKey,
      expiresInMinutes * 60,
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

// --- Session-replay helpers ---
// Reads from the session-replay bucket (S3 only) using the session-replay
// client. Used by the session-replay controller to (a) list the gzip-JSON
// chunks for a given session's storage prefix, and (b) hand out signed
// read URLs so the browser can fetch chunks directly from S3 — same pattern
// as AuthorizedImage.

/**
 * Returns `true` when the session-replay bucket is configured (S3 mode and
 * `S3_SESSION_REPLAY_BUCKET` set). Use this in the controller to short-circuit
 * with a clean 4xx when the deployment hasn't enabled session-replay reads.
 */
export function isSessionReplayStorageConfigured(): boolean {
  return UPLOAD_METHOD === "s3" && !!S3_SESSION_REPLAY_BUCKET;
}

/**
 * Lists every object key under `storagePrefix` in the session-replay bucket.
 * Returns the raw S3 keys (in S3 ordering, which is lexicographic — callers
 * that need numeric chunk-index ordering should sort after parsing).
 */
export async function listSessionReplayChunks(
  storagePrefix: string,
): Promise<string[]> {
  if (!isSessionReplayStorageConfigured()) {
    throw new Error(
      "Session-replay storage is not configured (set S3_SESSION_REPLAY_BUCKET)",
    );
  }
  return s3ListByPrefix(
    getSessionReplayS3Client(),
    S3_SESSION_REPLAY_BUCKET,
    storagePrefix,
  );
}

/**
 * Fetches a single session-replay chunk (gzipped JSON) from the session-replay
 * bucket. Mirror of `getFileBuffer` but routed through the session-replay
 * S3 client so the bucket+role for replay storage stay independent of the
 * general uploads bucket.
 */
export async function getSessionReplayObjectBuffer(
  key: string,
): Promise<Buffer> {
  if (!isSessionReplayStorageConfigured()) {
    throw new Error(
      "Session-replay storage is not configured (set S3_SESSION_REPLAY_BUCKET)",
    );
  }
  return s3GetObjectBuffer(
    getSessionReplayS3Client(),
    S3_SESSION_REPLAY_BUCKET,
    key,
  );
}
