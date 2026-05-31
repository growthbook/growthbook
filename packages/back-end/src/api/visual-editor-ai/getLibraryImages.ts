import { z } from "zod";
import { listFiles } from "back-end/src/services/files";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { requireUserAuth } from "./requireUserAuth";

// Library listing for the visual editor: every image the org has
// uploaded (manual upload tab) OR generated + accepted (AI tab) under
// the visual-editor prefix. Used by the side panel's "Library" tab
// to let users re-use existing images across experiments rather than
// re-uploading.
//
// Two prefixes are enumerated:
//   1. `<orgId>/visual-editor/`       — permanent, accepted images.
//   2. `gen/<orgId>/visual-editor/`   — AI-generated quarantine. These
//      images live for 7 days before the bucket lifecycle reaps them.
//      They're flagged with `isQuarantined: true` so the UI can show
//      an expiry note next to the grid.
//
// Combined cap of 1000 keys. ListObjectsV2 / getFiles returns up to
// 1000 per page; pagination via continuationToken is doable later if
// orgs end up with thousands of images, but that's a future problem.

const querySchema = z
  .object({
    // Total max items returned (combined across permanent + quarantine).
    // Bounded at 1000 to match a single S3 ListObjectsV2 page.
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
};

export const getLibraryImages = createApiRequestHandler(validation)(async (
  req,
) => {
  const context = req.context;
  // Require PAT auth — listing org assets requires a real user
  // identity, matching the rest of the visual-editor surface.
  requireUserAuth(context);

  const orgId = req.organization.id;
  const limit = Math.min(req.query.limit ?? 1000, 1000);
  // Sentinel log so dev users can confirm the request actually
  // reached the route handler vs hanging upstream (a stuck event
  // loop, a misconfigured proxy, the wrong API host etc.).
  logger.info(
    { orgId, limit },
    "[visual-editor-ai/library] listing image library",
  );
  // Split the budget across the two prefixes. The merge step below
  // takes the top `limit` by uploadedAt, so allocating half to each
  // prefix doesn't lose anything as long as the actual count per
  // prefix is below the half-budget — which it will be for any
  // realistic org. Worst case we over-fetch a bit; benign.
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
    // Surface as a generic error to the client; the bucket may be
    // misconfigured, the region wrong, or the key lacking
    // s3:ListBucket — none of which the side panel can fix, but
    // the user should know it didn't work.
    throw new Error(
      "Failed to load image library. The visual-editor storage bucket may be misconfigured.",
    );
  }

  const all = [
    ...permanent.map((f) => ({ ...f, isQuarantined: false })),
    ...quarantine.map((f) => ({ ...f, isQuarantined: true })),
  ];
  // Newest-first. ISO timestamps sort lexicographically, so a plain
  // string compare gives the right order without parsing dates.
  all.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));

  return { images: all.slice(0, limit) };
});
