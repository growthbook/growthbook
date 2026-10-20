import { z } from "zod";
import { listFiles } from "back-end/src/services/files";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { requireUserAuth } from "./requireUserAuth";

// Lists every image the org has under the visual-editor prefix.
// Enumerates two prefixes:
//   `<orgId>/visual-editor/`     — permanent, accepted images.
//   `gen/<orgId>/visual-editor/` — AI quarantine (7-day TTL via bucket
//                                  lifecycle); flagged isQuarantined.
// Capped at 1000 keys to fit one S3 ListObjectsV2 page; pagination is a
// future problem.

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(1000).optional(),
  })
  .strict();

const validation = {
  bodySchema: z.never(),
  querySchema,
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "get" as const,
  path: "/visual-editor/library/images",
  operationId: "getVisualEditorLibraryImages",
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

export const getLibraryImages = createApiRequestHandler(validation)(async (
  req,
) => {
  const context = req.context;
  requireUserAuth(context);

  const orgId = req.organization.id;
  const limit = Math.min(req.query.limit ?? 1000, 1000);
  logger.debug(
    { orgId, limit },
    "[visual-editor-ai/library] listing image library",
  );
  const perPrefix = Math.ceil(limit / 2);

  let permanent;
  let quarantine;
  try {
    [permanent, quarantine] = await Promise.all([
      listFiles(`${orgId}/visual-editor/`, "visual-editor-assets", perPrefix),
      listFiles(
        `gen/${orgId}/visual-editor/`,
        "visual-editor-assets",
        perPrefix,
      ),
    ]);
  } catch (e) {
    logger.warn(
      { err: e, orgId },
      "[visual-editor-ai/library] failed to list image library",
    );
    throw new Error(
      "Failed to load image library. The visual-editor storage bucket may be misconfigured.",
    );
  }

  const all = [
    ...permanent.map((f) => ({ ...f, isQuarantined: false })),
    ...quarantine.map((f) => ({ ...f, isQuarantined: true })),
  ];
  // ISO timestamps sort lexicographically (newest first).
  all.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));

  return { images: all.slice(0, limit) };
});
