import fs from "fs";
import path from "path";
import { getUploadsDir } from "back-end/src/services/files";
import { UPLOAD_METHOD } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

// When using local file storage, verify the uploads directory is writable by the
// current user. The runtime image is non-root (uid 1000); a volume created by an
// older root image is root-owned, which silently breaks uploads at request time.
// Surface it loudly at boot instead. Warn-only — uploads failing is non-fatal.
export async function uploadsInit() {
  if (UPLOAD_METHOD !== "local") return;

  let dir = "the uploads directory";
  try {
    dir = getUploadsDir();
    const probe = path.join(dir, ".write-probe");
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(probe, "");
    await fs.promises.unlink(probe);
  } catch {
    const uid = process.getuid?.();
    logger.warn(
      `Local uploads directory "${dir}" is not writable${
        uid !== undefined ? ` by uid ${uid}` : ""
      }. File and image uploads will fail. This image runs as a non-root user; ` +
        "if you mounted a volume created by an older root image, fix it once with " +
        "`docker run --rm -v <volume>:/data busybox chown -R 1000:1000 /data` " +
        "(or set UPLOAD_METHOD to s3/google-cloud). " +
        "See https://docs.growthbook.io/self-host#hardened-non-root-shell-less-image",
    );
  }
}
