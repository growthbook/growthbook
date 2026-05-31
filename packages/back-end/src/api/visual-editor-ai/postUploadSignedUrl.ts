import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getSignedUploadUrl } from "back-end/src/services/files";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireUserAuth } from "./requireUserAuth";

const MIMETYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const SIGNED_EXPIRY_MINUTES = 15;

// Cap on user-uploaded image size. Set conservatively for typical visual
// experiment assets (logos, hero images, swap targets). At 5 MB we cover
// retina-quality hero PNGs with comfortable headroom — only pathological
// uploads get rejected, and the storage cost of an accidentally-huge
// upload is bounded. Enforced server-side via the S3 presigned POST's
// content-length-range condition (the only real security boundary; the
// client-side check is UX only). Bump if real users complain.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const bodySchema = z
  .object({
    contentType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
    // Required so we can gate uploads on the same permission as updating
    // the visual changeset itself — otherwise a read-only collaborator
    // could write arbitrary content to the org S3 bucket.
    visualChangesetId: z.string(),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/ai/upload-signed-url",
  operationId: "postVisualEditorAIUploadSignedUrl",
};

// Returns a short-lived signed URL the extension can use to PUT/POST a file
// body directly to S3 (or whatever UPLOAD_METHOD points at). The path is
// scoped under the org and a visual-editor subfolder so cleanup is easy.
export const postUploadSignedUrl = createApiRequestHandler(validation)(async (
  req,
) => {
  const { contentType, visualChangesetId } = req.body;
  const org = req.organization;
  const context = req.context;
  // Require PAT auth — uploads issue write credentials for the org's
  // bucket; we want every upload attributable to a real user.
  requireUserAuth(context);

  if (org.settings?.blockFileUploads) {
    throw new Error("File uploads are disabled for this organization");
  }

  // Same gate as updating the visual changeset directly. Loading the
  // changeset first also scopes the call to one the caller's org owns.
  const changeset = await findVisualChangesetById(visualChangesetId, org.id);
  if (!changeset)
    return context.throwNotFoundError("Visual changeset not found");
  const experiment = await getExperimentById(context, changeset.experiment);
  if (!experiment) return context.throwNotFoundError("Experiment not found");
  if (!context.permissions.canUpdateVisualChange(experiment)) {
    context.permissions.throwPermissionError();
  }

  const ext = MIMETYPES[contentType];
  const filePath = `${org.id}/visual-editor/img_${uuidv4()}.${ext}`;

  const { signedUrl, fileUrl, fields, cacheControl, maxBytes } =
    await getSignedUploadUrl(
      filePath,
      contentType,
      SIGNED_EXPIRY_MINUTES,
      "visual-editor-assets",
      MAX_UPLOAD_BYTES,
    );

  return {
    signedUrl,
    fileUrl,
    filePath,
    fields: fields ?? null,
    // For S3, the Cache-Control header is already embedded in `fields` and
    // gets attached automatically by the multipart form post. For GCS,
    // the extension must send Cache-Control on its PUT — we surface the
    // value here so the client knows what to attach (and so the backend
    // remains the single source of truth for the cache directive).
    cacheControl: cacheControl ?? null,
    // Returned so the client can show an immediate "file too large"
    // error before attempting the upload. The S3 policy enforces the
    // same cap server-side either way.
    maxBytes: maxBytes ?? null,
    expiresAt: new Date(
      Date.now() + SIGNED_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString(),
  };
});
