import fs from "fs";
import { UPLOAD_METHOD } from "back-end/src/util/secrets";
import { getDestinationConfig, UploadDestination } from "./config";
import { gcsFileStorage } from "./gcs";
import { localFileStorage, resolveUploadPath } from "./local";
import { s3FileStorage } from "./s3";
import { FileStorage, ListedFile, SignedUploadUrl } from "./types";

export type { UploadDestination } from "./config";
export type { ListedFile } from "./types";
export { getUploadsDir, resolveUploadPath } from "./local";
export * from "./sessionReplay";

/** Where files are stored: `UPLOAD_METHOD` is "s3", "google-cloud", or "local". */
function getFileStorage(): FileStorage {
  switch (UPLOAD_METHOD) {
    case "s3":
      return s3FileStorage;
    case "google-cloud":
      return gcsFileStorage;
    default:
      return localFileStorage;
  }
}

// Watch out for poison null bytes
function assertSafeKey(key: string, name = "Filename") {
  if (key.indexOf("\0") !== -1) {
    throw new Error(`Error: ${name} must not contain null bytes`);
  }
}

export async function uploadFile(
  filePath: string,
  contentType: string,
  contents: Buffer,
  destination: UploadDestination = "private",
  // Optional caller context (e.g. orgId, userId) merged into the upload-failure
  // log so a single, richer entry is emitted per failure — callers should NOT
  // catch-and-log again on top of this.
  logContext: Record<string, unknown> = {},
): Promise<string> {
  assertSafeKey(filePath);
  return getFileStorage().upload(
    filePath,
    contentType,
    contents,
    getDestinationConfig(destination),
    { ...logContext, destination },
  );
}

/** A stored file's size in bytes, or null if it doesn't exist. */
export async function getFileSize(
  filePath: string,
  destination: UploadDestination = "private",
): Promise<number | null> {
  assertSafeKey(filePath);
  try {
    return await getFileStorage().getSize(
      filePath,
      getDestinationConfig(destination),
    );
  } catch {
    return null;
  }
}

/** Streams a stored file in chunks, without holding it all in memory. */
export function readFileStream(
  filePath: string,
  destination: UploadDestination = "private",
): AsyncIterable<Uint8Array> {
  assertSafeKey(filePath);
  return getFileStorage().readStream(
    filePath,
    getDestinationConfig(destination),
  );
}

/** Reads bytes `start` to `end` (inclusive) of a stored file. */
export async function readFileRange(
  filePath: string,
  start: number,
  end: number,
  destination: UploadDestination = "private",
): Promise<Buffer> {
  assertSafeKey(filePath);
  return getFileStorage().readRange(
    filePath,
    start,
    end,
    getDestinationConfig(destination),
  );
}

/** Deletes a stored file. Missing files are ignored. */
export async function deleteFile(
  filePath: string,
  destination: UploadDestination = "private",
): Promise<void> {
  assertSafeKey(filePath);
  await getFileStorage().delete(filePath, getDestinationConfig(destination));
}

/** A local-storage image, streamed by the back end's /upload route. */
export function getImageData(filePath: string) {
  assertSafeKey(filePath);
  const fullPath = resolveUploadPath(filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error("File not found");
  }
  return fs.createReadStream(fullPath);
}

export async function getSignedImageUrl(
  filePath: string,
  expiresInMinutes: number = 15,
  destination: UploadDestination = "private",
): Promise<string> {
  assertSafeKey(filePath);

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

  return getFileStorage().getSignedReadUrl(
    objectKey,
    expiresInMinutes,
    getDestinationConfig(destination),
  );
}

export async function getSignedUploadUrl(
  filePath: string,
  contentType: string,
  expiresInMinutes: number = 15,
  destination: UploadDestination = "private",
  // Server-enforced upper bound on upload size (S3 signs it into the
  // policy; GCS does not). 0/undefined = no cap.
  maxBytes?: number,
  // Lower bound, enforced only by S3 and only together with `maxBytes`.
  minBytes: number = 0,
): Promise<SignedUploadUrl> {
  assertSafeKey(filePath);

  // An SVG opened directly renders as a document and runs any <script> it
  // carries, in this bucket's origin. `attachment` makes a direct link
  // download instead; <img> embedding ignores it, so rendering is
  // unaffected. Defence in depth behind the CDN's CSP header.
  const contentDisposition =
    contentType === "image/svg+xml" ? "attachment" : null;

  return getFileStorage().getSignedUploadUrl(
    {
      key: filePath,
      contentType,
      expiresInMinutes,
      contentDisposition,
      maxBytes,
      minBytes,
    },
    getDestinationConfig(destination),
  );
}

// Move a file (copy + delete) within the same destination. Used by the
// AI-image-gen flow to promote a picked thumbnail out of the `gen/`
// quarantine prefix. Cache-control comes from destination config, not
// the source object.
export async function promoteFile(
  srcKey: string,
  destKey: string,
  destination: UploadDestination = "private",
): Promise<string> {
  assertSafeKey(srcKey);
  assertSafeKey(destKey);
  return getFileStorage().promote(
    srcKey,
    destKey,
    getDestinationConfig(destination),
  );
}

// List files under a prefix. Caps at `limit` (default 1000 = a single
// ListObjectsV2 / getFiles page). Sort order is backend-defined.
export async function listFiles(
  prefix: string,
  destination: UploadDestination = "private",
  limit: number = 1000,
): Promise<ListedFile[]> {
  assertSafeKey(prefix, "Prefix");
  return getFileStorage().list(
    prefix,
    limit,
    getDestinationConfig(destination),
  );
}
