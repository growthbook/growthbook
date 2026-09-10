import { DiscussionModel } from "back-end/src/models/DiscussionModel";
import { deleteFile, getUploadUrlPrefix } from "back-end/src/services/files";
import { logger } from "back-end/src/util/logger";

const MARKDOWN_IMAGE_URL = /!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getDiscussionUploadUrls(
  content: string,
  organization: string,
  uploadUrlPrefixes: string[],
): Map<string, string> {
  const uploadKeyPattern = new RegExp(
    `^${escapeRegex(organization)}/\\d{4}-(?:0[1-9]|1[0-2])/img_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:png|jpe?g|gif)$`,
    "i",
  );
  const uploads = new Map<string, string>();

  for (const match of content.matchAll(MARKDOWN_IMAGE_URL)) {
    const url = match[1];
    if (!url) continue;

    const prefix = uploadUrlPrefixes.find((candidate) =>
      url.startsWith(candidate),
    );
    if (!prefix) continue;

    const key = url.slice(prefix.length);
    if (uploadKeyPattern.test(key)) {
      uploads.set(key, url);
    }
  }

  return uploads;
}

export async function cleanupDeletedDiscussionUploads({
  content,
  organization,
  localOrigin,
}: {
  content: string;
  organization: string;
  localOrigin: string;
}): Promise<void> {
  const uploadUrlPrefix = getUploadUrlPrefix(localOrigin);
  const uploadUrlPrefixes = [uploadUrlPrefix];
  const localUploadUrlPrefix = `${localOrigin.replace(/\/+$/, "")}/upload/`;
  if (uploadUrlPrefix === localUploadUrlPrefix) {
    uploadUrlPrefixes.push("/upload/");
  }

  const uploads = getDiscussionUploadUrls(
    content,
    organization,
    uploadUrlPrefixes,
  );

  await Promise.all(
    Array.from(uploads, async ([key, url]) => {
      try {
        const referenced = await DiscussionModel.exists({
          organization,
          "comments.content": { $regex: escapeRegex(url) },
        });
        if (!referenced) {
          await deleteFile(key);
        }
      } catch (err) {
        logger.error(
          { err, organization, key },
          "Failed to clean up deleted discussion upload",
        );
      }
    }),
  );
}
