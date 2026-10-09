import { Storage } from "@google-cloud/storage";
import { logger } from "back-end/src/util/logger";
import { joinUrl } from "./config";
import { FileStorage } from "./types";

export const gcsFileStorage: FileStorage = {
  async upload(key, contentType, contents, cfg, logContext) {
    try {
      await new Storage()
        .bucket(cfg.gcsBucket)
        .file(key)
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
          bucket: cfg.gcsBucket,
          key,
          contentType,
          bytes: contents.length,
        },
        "[files] GCS upload failed",
      );
      throw err;
    }
    return joinUrl(cfg.gcsDomain, key);
  },

  async getSize(key, cfg) {
    const [metadata] = await new Storage()
      .bucket(cfg.gcsBucket)
      .file(key)
      .getMetadata();
    return Number(metadata.size);
  },

  async *readStream(key, cfg) {
    yield* new Storage()
      .bucket(cfg.gcsBucket)
      .file(key)
      .createReadStream() as AsyncIterable<Uint8Array>;
  },

  async readRange(key, start, end, cfg) {
    const [contents] = await new Storage()
      .bucket(cfg.gcsBucket)
      .file(key)
      .download({ start, end });
    return contents;
  },

  async delete(key, cfg) {
    await new Storage()
      .bucket(cfg.gcsBucket)
      .file(key)
      .delete({ ignoreNotFound: true });
  },

  async getSignedReadUrl(key, expiresInMinutes, cfg) {
    const [signedUrl] = await new Storage()
      .bucket(cfg.gcsBucket)
      .file(key)
      .getSignedUrl({
        action: "read",
        expires: Date.now() + expiresInMinutes * 60 * 1000,
      });
    return signedUrl;
  },

  async getSignedUploadUrl(
    { key, contentType, expiresInMinutes, contentDisposition, maxBytes },
    cfg,
  ) {
    // GCS rejects uploads if Content-Type doesn't match exactly. When
    // Cache-Control is configured the browser must send the matching
    // header on its PUT, signed via extensionHeaders.
    const [signedUrl] = await new Storage()
      .bucket(cfg.gcsBucket)
      .file(key)
      .getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + expiresInMinutes * 60 * 1000,
        contentType,
        extensionHeaders: {
          ...(cfg.cacheControl ? { "cache-control": cfg.cacheControl } : {}),
          ...(contentDisposition
            ? { "content-disposition": contentDisposition }
            : {}),
        },
      });

    return {
      signedUrl,
      fileUrl: joinUrl(cfg.gcsDomain, key),
      cacheControl: cfg.cacheControl ?? null,
      contentDisposition,
      // FOOTGUN: GCS V4 signed URLs don't support content-length-range,
      // so the size cap is client-side only here — a known enforcement
      // gap to revisit (e.g., delete oversize uploads post-hoc).
      maxBytes: maxBytes ?? null,
    };
  },

  async copy(srcKey, destKey, cfg) {
    const bucket = new Storage().bucket(cfg.gcsBucket);
    await bucket.file(srcKey).copy(bucket.file(destKey));
  },

  async promote(srcKey, destKey, cfg) {
    const bucket = new Storage().bucket(cfg.gcsBucket);
    const srcFile = bucket.file(srcKey);
    const destFile = bucket.file(destKey);
    // GCS .copy() preserves source metadata; override cache-control
    // post-copy to match a direct upload to this destination.
    await srcFile.copy(destFile);
    if (cfg.cacheControl) {
      await destFile.setMetadata({ cacheControl: cfg.cacheControl });
    }
    await srcFile.delete();
    return joinUrl(cfg.gcsDomain, destKey);
  },

  async list(prefix, limit, cfg) {
    const [files] = await new Storage()
      .bucket(cfg.gcsBucket)
      .getFiles({ prefix, maxResults: limit });
    return files.map((f) => ({
      key: f.name,
      url: joinUrl(cfg.gcsDomain, f.name),
      // GCS metadata.size is a string; coerce defensively.
      size: parseInt(String(f.metadata.size ?? "0"), 10) || 0,
      uploadedAt: String(f.metadata.timeCreated ?? ""),
    }));
  },
};
