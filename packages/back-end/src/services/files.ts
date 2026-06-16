import path from "path";
import fs from "fs";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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
  VISUAL_EDITOR_ASSETS_S3_BUCKET,
  VISUAL_EDITOR_ASSETS_S3_REGION,
  VISUAL_EDITOR_ASSETS_S3_DOMAIN,
  VISUAL_EDITOR_ASSETS_GCS_BUCKET_NAME,
  VISUAL_EDITOR_ASSETS_GCS_DOMAIN,
} from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

// "private" is the existing bucket served via signed URLs.
// "visual-editor-assets" is the public, CDN-fronted bucket.
export type UploadDestination = "private" | "visual-editor-assets";

interface DestinationConfig {
  s3Bucket: string;
  s3Region: string;
  s3Domain: string;
  gcsBucket: string;
  gcsDomain: string;
  // `undefined` means no Cache-Control header is set — private uploads
  // intentionally skip it so signed-URL responses aren't marked public
  // and replaceable files aren't pinned immutable.
  cacheControl: string | undefined;
}

function getDestinationConfig(dest: UploadDestination): DestinationConfig {
  if (dest === "visual-editor-assets") {
    return {
      s3Bucket: VISUAL_EDITOR_ASSETS_S3_BUCKET,
      s3Region: VISUAL_EDITOR_ASSETS_S3_REGION,
      s3Domain: VISUAL_EDITOR_ASSETS_S3_DOMAIN,
      gcsBucket: VISUAL_EDITOR_ASSETS_GCS_BUCKET_NAME,
      gcsDomain: VISUAL_EDITOR_ASSETS_GCS_DOMAIN,
      // Files are UUID-keyed and never overwritten.
      cacheControl: "public, max-age=31536000, immutable",
    };
  }
  return {
    s3Bucket: S3_BUCKET,
    s3Region: S3_REGION,
    s3Domain: S3_DOMAIN,
    gcsBucket: GCS_BUCKET_NAME,
    gcsDomain: GCS_DOMAIN,
    cacheControl: undefined,
  };
}

// One S3 client per region — the visual-editor-assets bucket can live
// in a different region from the private bucket.
const s3Clients = new Map<string, S3Client>();

function getS3Client(region: string): S3Client {
  let client = s3Clients.get(region);
  if (!client) {
    const clientConfig: ConstructorParameters<typeof S3Client>[0] = { region };

    if (AWS_ASSUME_ROLE) {
      clientConfig.credentials = fromTemporaryCredentials({
        params: {
          RoleArn: AWS_ASSUME_ROLE,
          RoleSessionName: "growthbook-uploads",
        },
      });
    }

    client = new S3Client(clientConfig);
    s3Clients.set(region, client);
  }
  return client;
}

export function getUploadsDir() {
  return path.join(__dirname, "..", "..", "uploads");
}

// Join an upload key onto the uploads dir, rejecting anything that escapes it.
// The separator-aware boundary check (vs. a bare prefix match) is what stops a
// sibling like "uploads-evil" or a "../" traversal from slipping through.
export function resolveUploadPath(key: string): string {
  const rootDirectory = getUploadsDir();
  const fullPath = path.join(rootDirectory, key);
  if (
    fullPath !== rootDirectory &&
    !fullPath.startsWith(rootDirectory + path.sep)
  ) {
    throw new Error(
      "Error: Path must not escape out of the 'uploads' directory.",
    );
  }
  return fullPath;
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
) {
  // Watch out for poison null bytes
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("Error: Filename must not contain null bytes");
  }

  const cfg = getDestinationConfig(destination);
  let fileURL = "";

  if (UPLOAD_METHOD === "s3") {
    const client = getS3Client(cfg.s3Region);
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.s3Bucket,
          Key: filePath,
          Body: contents,
          ContentType: contentType,
          ...(cfg.cacheControl ? { CacheControl: cfg.cacheControl } : {}),
        }),
      );
    } catch (err) {
      // The API handler returns thrown errors to the client without
      // logging them, so without this the S3 push failing is invisible
      // server-side. Log enough to tell "which bucket/region/key" before
      // re-throwing so the original failure still surfaces to the caller.
      logger.error(
        {
          ...logContext,
          err,
          destination,
          bucket: cfg.s3Bucket,
          region: cfg.s3Region,
          key: filePath,
          contentType,
          bytes: contents.length,
        },
        "[files] S3 PutObject failed",
      );
      throw err;
    }
    fileURL = cfg.s3Domain + (cfg.s3Domain.endsWith("/") ? "" : "/") + filePath;
  } else if (UPLOAD_METHOD === "google-cloud") {
    const storage = new Storage();

    try {
      await storage
        .bucket(cfg.gcsBucket)
        .file(filePath)
        .save(contents, {
          contentType: contentType,
          ...(cfg.cacheControl
            ? { metadata: { cacheControl: cfg.cacheControl } }
            : {}),
        });
    } catch (err) {
      logger.error(
        {
          ...logContext,
          err,
          destination,
          bucket: cfg.gcsBucket,
          key: filePath,
          contentType,
          bytes: contents.length,
        },
        "[files] GCS upload failed",
      );
      throw err;
    }
    fileURL =
      cfg.gcsDomain + (cfg.gcsDomain.endsWith("/") ? "" : "/") + filePath;
  } else {
    const fullPath = resolveUploadPath(filePath);
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
  // Watch out for poison null bytes
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("Error: Filename must not contain null bytes");
  }

  const cfg = getDestinationConfig(destination);

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
    const client = getS3Client(cfg.s3Region);
    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: cfg.s3Bucket,
        Key: objectKey,
      }),
      { expiresIn: expiresInMinutes * 60 },
    );
  } else if (UPLOAD_METHOD === "google-cloud") {
    const storage = new Storage();
    const bucket = storage.bucket(cfg.gcsBucket);
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
  destination: UploadDestination = "private",
  // Server-enforced upper bound on upload size (S3 signs it into the
  // policy; GCS does not — see GCS branch below). 0/undefined = no cap.
  maxBytes?: number,
): Promise<{
  signedUrl: string;
  fileUrl: string;
  fields?: Record<string, string>;
  // The Cache-Control header the client must send with its PUT/POST.
  // `null` when no cache header is configured for this destination.
  cacheControl: string | null;
  // Echoes the size cap so the client can do an early-error check.
  maxBytes: number | null;
}> {
  // Watch out for poison null bytes
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("Error: Filename must not contain null bytes");
  }

  const cfg = getDestinationConfig(destination);

  if (UPLOAD_METHOD === "s3") {
    const client = getS3Client(cfg.s3Region);
    // Cache-Control must appear as BOTH a Field and a Condition —
    // without the Condition S3 rejects with "extra input fields".
    const conditions: Array<
      ["eq", string, string] | ["content-length-range", number, number]
    > = [
      ["eq", "$Content-Type", contentType],
      ["eq", "$key", filePath],
    ];
    const fields: Record<string, string> = {
      key: filePath,
      "Content-Type": contentType,
    };
    if (cfg.cacheControl) {
      conditions.push(["eq", "$Cache-Control", cfg.cacheControl]);
      fields["Cache-Control"] = cfg.cacheControl;
    }
    // content-length-range is the actual server-side size enforcement;
    // any client-side check is just UX.
    if (maxBytes && maxBytes > 0) {
      conditions.push(["content-length-range", 0, maxBytes]);
    }

    const { url, fields: signedFields } = await createPresignedPost(client, {
      Bucket: cfg.s3Bucket,
      Key: filePath,
      Conditions: conditions,
      Fields: fields,
      Expires: expiresInMinutes * 60,
    });

    const fileUrl =
      cfg.s3Domain + (cfg.s3Domain.endsWith("/") ? "" : "/") + filePath;

    return {
      signedUrl: url,
      fileUrl,
      fields: signedFields as Record<string, string>,
      cacheControl: cfg.cacheControl ?? null,
      maxBytes: maxBytes ?? null,
    };
  } else if (UPLOAD_METHOD === "google-cloud") {
    const storage = new Storage();
    const bucket = storage.bucket(cfg.gcsBucket);
    const file = bucket.file(filePath);

    // GCS rejects uploads if Content-Type doesn't match exactly. When
    // Cache-Control is configured the browser must send the matching
    // header on its PUT, signed via extensionHeaders.
    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + expiresInMinutes * 60 * 1000,
      contentType,
      ...(cfg.cacheControl
        ? { extensionHeaders: { "cache-control": cfg.cacheControl } }
        : {}),
    });

    const fileUrl =
      cfg.gcsDomain + (cfg.gcsDomain.endsWith("/") ? "" : "/") + filePath;

    return {
      signedUrl,
      fileUrl,
      cacheControl: cfg.cacheControl ?? null,
      // FOOTGUN: GCS V4 signed URLs don't support content-length-range,
      // so the size cap is client-side only here — a known enforcement
      // gap to revisit (e.g., delete oversize uploads post-hoc).
      maxBytes: maxBytes ?? null,
    };
  } else {
    throw new Error(
      "Signed upload URLs are only supported for S3 and Google Cloud Storage",
    );
  }
}

// Move a file (copy + delete) within the same destination. Used by the
// AI-image-gen flow to promote a picked thumbnail out of the `gen/`
// quarantine prefix. Cache-control comes from destination config, not
// the source object — see S3 branch for the MetadataDirective dance
// that's required to make that override stick.
export async function promoteFile(
  srcKey: string,
  destKey: string,
  destination: UploadDestination = "private",
): Promise<string> {
  // Watch out for poison null bytes in either key.
  if (srcKey.indexOf("\0") !== -1 || destKey.indexOf("\0") !== -1) {
    throw new Error("Error: Filename must not contain null bytes");
  }

  const cfg = getDestinationConfig(destination);

  if (UPLOAD_METHOD === "s3") {
    const client = getS3Client(cfg.s3Region);
    // FOOTGUN: MetadataDirective: REPLACE wipes Content-Type along with
    // everything else. Without re-supplying it the destination defaults
    // to `binary/octet-stream` (browsers download instead of render) and
    // gets pinned that way by our immutable cache headers. HEAD the
    // source first so we can echo its Content-Type onto the copy.
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: cfg.s3Bucket,
        Key: srcKey,
      }),
    );
    await client.send(
      new CopyObjectCommand({
        Bucket: cfg.s3Bucket,
        // S3 CopySource is `<bucket>/<key>`, URI-encoded except `/`.
        CopySource: `${cfg.s3Bucket}/${encodeURIComponent(srcKey).replace(/%2F/g, "/")}`,
        Key: destKey,
        // REPLACE so the destination picks up our cache headers
        // (see Content-Type re-supply note above).
        MetadataDirective: "REPLACE",
        ...(head.ContentType ? { ContentType: head.ContentType } : {}),
        ...(cfg.cacheControl ? { CacheControl: cfg.cacheControl } : {}),
      }),
    );
    await client.send(
      new DeleteObjectCommand({
        Bucket: cfg.s3Bucket,
        Key: srcKey,
      }),
    );
    return cfg.s3Domain + (cfg.s3Domain.endsWith("/") ? "" : "/") + destKey;
  } else if (UPLOAD_METHOD === "google-cloud") {
    const storage = new Storage();
    const bucket = storage.bucket(cfg.gcsBucket);
    const srcFile = bucket.file(srcKey);
    const destFile = bucket.file(destKey);
    // GCS .copy() preserves source metadata; override cache-control
    // post-copy to match a direct upload to this destination.
    await srcFile.copy(destFile);
    if (cfg.cacheControl) {
      await destFile.setMetadata({ cacheControl: cfg.cacheControl });
    }
    await srcFile.delete();
    return cfg.gcsDomain + (cfg.gcsDomain.endsWith("/") ? "" : "/") + destKey;
  } else {
    // Local filesystem (dev): just rename.
    const srcPath = resolveUploadPath(srcKey);
    const destPath = resolveUploadPath(destKey);
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.rename(srcPath, destPath);
    return `/upload/${destKey}`;
  }
}

// Backend-agnostic listed file shape (S3 / GCS / local).
export interface ListedFile {
  key: string;
  url: string;
  size: number;
  // ISO 8601 timestamp; empty string if the backend can't supply one.
  uploadedAt: string;
}

// List files under a prefix. Caps at `limit` (default 1000 = a single
// ListObjectsV2 / getFiles page). Sort order is backend-defined.
export async function listFiles(
  prefix: string,
  destination: UploadDestination = "private",
  limit: number = 1000,
): Promise<ListedFile[]> {
  if (prefix.indexOf("\0") !== -1) {
    throw new Error("Error: Prefix must not contain null bytes");
  }
  const cfg = getDestinationConfig(destination);

  if (UPLOAD_METHOD === "s3") {
    const client = getS3Client(cfg.s3Region);
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.s3Bucket,
        Prefix: prefix,
        MaxKeys: limit,
      }),
    );
    const baseUrl = cfg.s3Domain + (cfg.s3Domain.endsWith("/") ? "" : "/");
    return (result.Contents || [])
      .filter((obj): obj is { Key: string } & typeof obj => !!obj.Key)
      .map((obj) => ({
        key: obj.Key,
        url: baseUrl + obj.Key,
        size: obj.Size ?? 0,
        uploadedAt: obj.LastModified?.toISOString() ?? "",
      }));
  } else if (UPLOAD_METHOD === "google-cloud") {
    const storage = new Storage();
    const bucket = storage.bucket(cfg.gcsBucket);
    const [files] = await bucket.getFiles({ prefix, maxResults: limit });
    const baseUrl = cfg.gcsDomain + (cfg.gcsDomain.endsWith("/") ? "" : "/");
    return files.map((f) => ({
      key: f.name,
      url: baseUrl + f.name,
      // GCS metadata.size is a string; coerce defensively.
      size: parseInt(String(f.metadata.size ?? "0"), 10) || 0,
      uploadedAt: String(f.metadata.timeCreated ?? ""),
    }));
  } else {
    // Local filesystem (dev).
    const dir = resolveUploadPath(prefix);
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: ListedFile[] = [];
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const full = path.join(dir, ent.name);
      const stat = await fs.promises.stat(full);
      out.push({
        key: `${prefix}${ent.name}`,
        url: `/upload/${prefix}${ent.name}`,
        size: stat.size,
        uploadedAt: stat.mtime.toISOString(),
      });
      if (out.length >= limit) break;
    }
    return out;
  }
}
