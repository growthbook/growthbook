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

// Enforced server-side via the S3 presigned POST's content-length-range
// condition; client-side check is UX only.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const bodySchema = z
  .object({
    contentType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
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
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

// Returns a short-lived signed URL the extension uses to PUT/POST a file
// body directly to S3.
export const postUploadSignedUrl = createApiRequestHandler(validation)(async (
  req,
) => {
  const { contentType, visualChangesetId } = req.body;
  const org = req.organization;
  const context = req.context;
  requireUserAuth(context);

  if (org.settings?.blockFileUploads) {
    throw new Error("File uploads are disabled for this organization");
  }

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
    // S3 embeds Cache-Control in `fields`; GCS clients must send it on the
    // PUT themselves, so we surface the value here.
    cacheControl: cacheControl ?? null,
    // Lets the client show "file too large" before attempting the upload.
    maxBytes: maxBytes ?? null,
    expiresAt: new Date(
      Date.now() + SIGNED_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString(),
  };
});
