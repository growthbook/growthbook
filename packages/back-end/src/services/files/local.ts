import path from "path";
import fs from "fs";
import { FileStorage, ListedFile } from "./types";

// Local disk, for development and simple self-hosted installs. Files are
// served by the back end at /upload/...
export function getUploadsDir() {
  return path.join(__dirname, "..", "..", "..", "uploads");
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

const noSignedUrls = () =>
  Promise.reject(
    new Error(
      "Signed upload URLs are only supported for S3 and Google Cloud Storage",
    ),
  );

export const localFileStorage: FileStorage = {
  async upload(key, contentType, contents) {
    const fullPath = resolveUploadPath(key);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, contents);
    return `/upload/${key}`;
  },

  async getSize(key) {
    return (await fs.promises.stat(resolveUploadPath(key))).size;
  },

  async *readStream(key) {
    yield* fs.createReadStream(resolveUploadPath(key));
  },

  async readRange(key, start, end) {
    const handle = await fs.promises.open(resolveUploadPath(key), "r");
    try {
      const buffer = Buffer.alloc(end - start + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },

  async delete(key) {
    await fs.promises.rm(resolveUploadPath(key), { force: true });
  },

  getSignedReadUrl: noSignedUrls,
  getSignedUploadUrl: noSignedUrls,

  async promote(srcKey, destKey) {
    const srcPath = resolveUploadPath(srcKey);
    const destPath = resolveUploadPath(destKey);
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.rename(srcPath, destPath);
    return `/upload/${destKey}`;
  },

  async list(prefix, limit) {
    const dir = resolveUploadPath(prefix);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: ListedFile[] = [];
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const stat = await fs.promises.stat(path.join(dir, ent.name));
      out.push({
        key: `${prefix}${ent.name}`,
        url: `/upload/${prefix}${ent.name}`,
        size: stat.size,
        uploadedAt: stat.mtime.toISOString(),
      });
      if (out.length >= limit) break;
    }
    return out;
  },
};
