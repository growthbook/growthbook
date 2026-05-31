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

// Upload destinations. The default ("private") is the existing private
// bucket used for screenshots, attachments, etc. — files in this bucket
// are read via short-lived signed URLs and shouldn't be CDN-cached.
//
// "visual-editor-assets" routes to the public, CDN-fronted bucket
// configured via VISUAL_EDITOR_ASSETS_*. These files are content-addressed
// (UUID-keyed) and immutable, so we tell browsers + CDNs to cache forever.
export type UploadDestination = "private" | "visual-editor-assets";

interface DestinationConfig {
  s3Bucket: string;
  s3Region: string;
  s3Domain: string;
  gcsBucket: string;
  gcsDomain: string;
  // The Cache-Control value to write alongside the upload. `undefined`
  // means we won't set any header — S3/GCS clients and downstream caches
  // fall back to their normal defaults. We deliberately don't set
  // `public, max-age=…, immutable` for the private destination because:
  //   1. signed-URL responses shouldn't tell intermediate proxies they're
  //      cacheable as public,
  //   2. private uploads may be replaced/edited and shouldn't be marked
  //      immutable.
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
      // Files are UUID-keyed and never overwritten, so we can cache
      // forever. The one-year + `immutable` recipe is the standard for
      // content-addressed assets behind a CDN.
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

// One S3 client per region. Most installs use a single region but the
// visual-editor-assets bucket can live in a different one (e.g. closer to
// the CDN POP).
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

export async function uploadFile(
  filePath: string,
  contentType: string,
  contents: Buffer,
  destination: UploadDestination = "private",
) {
  // Watch out for poison null bytes
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("Error: Filename must not contain null bytes");
  }

  const cfg = getDestinationConfig(destination);
  let fileURL = "";

  if (UPLOAD_METHOD === "s3") {
    const client = getS3Client(cfg.s3Region);
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.s3Bucket,
        Key: filePath,
        Body: contents,
        ContentType: contentType,
        // Only set when the destination opts in — private uploads use the
        // S3 default (no header) so signed-URL responses behave correctly
        // and replaceable files don't get pinned in browser caches.
        ...(cfg.cacheControl ? { CacheControl: cfg.cacheControl } : {}),
      }),
    );
    fileURL = cfg.s3Domain + (cfg.s3Domain.endsWith("/") ? "" : "/") + filePath;
  } else if (UPLOAD_METHOD === "google-cloud") {
    const storage = new Storage();

    await storage
      .bucket(cfg.gcsBucket)
      .file(filePath)
      .save(contents, {
        contentType: contentType,
        ...(cfg.cacheControl
          ? { metadata: { cacheControl: cfg.cacheControl } }
          : {}),
      });
    fileURL =
      cfg.gcsDomain + (cfg.gcsDomain.endsWith("/") ? "" : "/") + filePath;
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
  // Hard upper bound on file size, in bytes. Enforced by the storage
  // provider on the actual upload (S3 rejects with EntityTooLarge; GCS
  // signs the size into the URL so anything larger fails the signature
  // check). 0 / undefined means "no cap" — callers SHOULD pass a value
  // for any user-facing upload path; defaulting to no cap keeps existing
  // internal callers behavior-compatible.
  maxBytes?: number,
): Promise<{
  signedUrl: string;
  fileUrl: string;
  fields?: Record<string, string>;
  // The Cache-Control header the client MUST send with its PUT/POST so
  // the bytes that land in storage carry the cache directive. Returned to
  // the caller so the extension knows what to attach. `null` when no
  // cache header is configured for this destination.
  cacheControl: string | null;
  // Echoes the size cap the URL was signed with (S3) or implies (GCS),
  // so the calling API handler can hand it to the client for an early
  // "file too large" check before attempting the upload. `null` means
  // no cap was applied.
  maxBytes: number | null;
}> {
  // Watch out for poison null bytes
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("Error: Filename must not contain null bytes");
  }

  const cfg = getDestinationConfig(destination);

  if (UPLOAD_METHOD === "s3") {
    const client = getS3Client(cfg.s3Region);
    // Build the S3 policy. When this destination opts into a Cache-Control
    // header, we add it both as a Field (so the browser's multipart form
    // automatically sends it) AND a Condition (so S3's policy validation
    // accepts it — without the Condition S3 rejects the upload with an
    // "extra input fields" policy error).
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
    // The content-length-range condition gives S3 a server-enforced
    // cap on the upload body size. The browser can lie about file size
    // via the multipart form, so this is the actual security boundary
    // — client-side checks are UX, this is enforcement.
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

    // GCS will reject uploads if the Content-Type header doesn't match
    // exactly. When this destination has a Cache-Control header, sign it
    // via extensionHeaders so the browser must send the matching header
    // on its PUT — see ImageReplacePanel for the client side.
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
      // GCS V4 signed URLs don't natively support a content-length-range
      // condition the way S3 presigned POSTs do. The signed URL covers
      // method + content-type + cache-control via extensionHeaders, but
      // not a body size cap. We return maxBytes so the client can still
      // do an early-error check; relying on the client alone for size
      // enforcement here is a known gap for GCS that should be revisited
      // (e.g., by inspecting size post-upload and deleting on overflow).
      maxBytes: maxBytes ?? null,
    };
  } else {
    throw new Error(
      "Signed upload URLs are only supported for S3 and Google Cloud Storage",
    );
  }
}

// Move a file from one key to another within the same destination's
// storage backend. Used by the AI-image-gen "promote" flow: thumbnails
// are uploaded to a quarantine prefix (`gen/`) and only the picked
// image gets promoted out to its permanent location. Files left behind
// in the quarantine prefix are reaped by a lifecycle policy.
//
// S3/GCS don't have a real move primitive — both providers implement
// move as copy + delete. We preserve content-type + cache-control from
// the destination config (NOT from the source object) so promoted
// files end up with the same headers as a direct upload to the same
// destination. The S3 copy uses `MetadataDirective: REPLACE` to make
// that override stick — otherwise CopyObject inherits the source's
// metadata.
//
// Returns the public URL for the destination key.
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
    // MetadataDirective: REPLACE drops ALL of the source object's
    // metadata — including its Content-Type. If we don't explicitly set
    // ContentType on the copy, S3 defaults the destination to
    // `binary/octet-stream`, which makes browsers offer the image as a
    // download instead of rendering it. Worse, the destination is served
    // with `immutable` cache headers, so a CDN would cache the wrong
    // content type effectively forever. Read the source's content type
    // first and echo it onto the copy so the promoted object matches a
    // direct upload.
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: cfg.s3Bucket,
        Key: srcKey,
      }),
    );
    // S3 CopySource is `<bucket>/<key>` URL-encoded. The SDK handles
    // basic encoding for us but we still need to URI-encode any
    // characters that aren't ASCII-safe — the key path comes from
    // user-org-scoped UUIDs so it's safe in practice, but we encode
    // defensively in case the convention ever changes.
    await client.send(
      new CopyObjectCommand({
        Bucket: cfg.s3Bucket,
        CopySource: `${cfg.s3Bucket}/${encodeURIComponent(srcKey).replace(/%2F/g, "/")}`,
        Key: destKey,
        // REPLACE so the destination picks up the configured cache
        // headers rather than inheriting from source — but that also
        // wipes the source Content-Type, so we re-supply it below.
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
    // GCS .copy() preserves metadata by default. Override cache-control
    // post-copy so the destination matches a direct-upload to the same
    // location.
    await srcFile.copy(destFile);
    if (cfg.cacheControl) {
      await destFile.setMetadata({ cacheControl: cfg.cacheControl });
    }
    await srcFile.delete();
    return cfg.gcsDomain + (cfg.gcsDomain.endsWith("/") ? "" : "/") + destKey;
  } else {
    // Local filesystem — used for dev. Just rename the file.
    const rootDirectory = getUploadsDir();
    const srcPath = path.join(rootDirectory, srcKey);
    const destPath = path.join(rootDirectory, destKey);
    // Prevent directory traversal on either end.
    if (
      srcPath.indexOf(rootDirectory) !== 0 ||
      destPath.indexOf(rootDirectory) !== 0
    ) {
      throw new Error(
        "Error: Path must not escape out of the 'uploads' directory.",
      );
    }
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.rename(srcPath, destPath);
    return `/upload/${destKey}`;
  }
}

// Listed result row. We return the same shape regardless of backend
// (S3 / GCS / local) so the API consumer doesn't have to switch on
// upload method.
export interface ListedFile {
  key: string;
  url: string;
  size: number;
  // ISO 8601 timestamp. Empty string when the backend doesn't expose
  // a modification time (rare; local-fs always has one, S3 + GCS
  // always have one).
  uploadedAt: string;
}

// List files under a prefix within the configured destination's
// storage backend. Used by the visual editor's "Library" tab to
// enumerate previously uploaded + AI-generated images for re-use
// across experiments. Caps at `limit` keys (default 1000 — single
// ListObjectsV2 / getFiles page) since orgs aren't expected to
// accumulate that many; pagination can be added later if needed.
//
// The returned `url` is the public CDN URL (or local /upload/ path
// in dev), already absolute. Sort order is backend-defined — callers
// that need newest-first should sort by uploadedAt themselves.
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
    // Local filesystem (dev). Enumerate the prefix directory under
    // the uploads root, mtime as the timestamp.
    const rootDirectory = getUploadsDir();
    const dir = path.join(rootDirectory, prefix);
    // Defense in depth against traversal — same rule as uploadFile.
    if (dir.indexOf(rootDirectory) !== 0) {
      throw new Error("Error: Prefix must not escape the uploads directory.");
    }
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
      // Stat per file; on a hot tab this would be worth caching, but
      // the local backend is dev-only and orgs there don't accumulate
      // many files.
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
