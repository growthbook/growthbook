import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { uploadFile } from "back-end/src/services/files";
import { optimizeAIImage } from "back-end/src/services/imageOptimization";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { generateImages } from "back-end/src/services/imageGeneration";
import { secondsUntilAICanBeUsedAgain } from "back-end/src/enterprise/services/ai";
import { updateTokenUsage } from "back-end/src/models/AITokenUsageModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { requireUserAuth } from "./requireUserAuth";

// Token-equivalent cost per generated image, charged against the org's
// daily AI budget. Matches Gemini's published ~1290 tokens/image; other
// supported providers (DALL-E 3, Imagen 4, gpt-image-1 standard, Grok)
// are roughly the same order of magnitude. Revisit if a much pricier
// model (e.g. gpt-image-1 `high`) is added.
const IMAGE_GEN_TOKEN_COST_PER_IMAGE = 1290;

// Base64 bytes rather than a URL — no SSRF surface; the back-end never
// fetches arbitrary URLs on the caller's behalf.
const referenceImageSchema = z.object({
  // Plain base64 (no `data:...;base64,` prefix). 8 MB cap rejects
  // payloads before decode that would blow past the endpoint body limit.
  data: z
    .string()
    .min(1)
    .max(8 * 1024 * 1024),
  mimeType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
});

const bodySchema = z
  .object({
    prompt: z.string().min(1).max(1000),
    aspectRatio: z.string().optional(),
    count: z.number().int().min(1).max(4).optional(),
    // Required so we can gate on canUpdateVisualChange — without it any
    // read-only key could burn paid provider calls + write to S3.
    visualChangesetId: z.string(),
    // Only Gemini *-image-preview variants currently accept this.
    referenceImage: referenceImageSchema.optional(),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/ai/image-gen",
  operationId: "postVisualEditorAIImageGen",
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

export const postAIImageGen = createApiRequestHandler(validation)(async (
  req,
) => {
  const {
    prompt,
    aspectRatio,
    count = 4,
    visualChangesetId,
    referenceImage,
  } = req.body;
  const org = req.organization;
  const context = req.context;
  requireUserAuth(context);

  if (org.settings?.blockFileUploads) {
    throw new Error("File uploads are disabled for this organization");
  }

  const changeset = await findVisualChangesetById(
    visualChangesetId,
    req.organization.id,
  );
  if (!changeset)
    return context.throwNotFoundError("Visual changeset not found");
  const experiment = await getExperimentById(context, changeset.experiment);
  if (!experiment) return context.throwNotFoundError("Experiment not found");
  if (!context.permissions.canUpdateVisualChange(experiment)) {
    context.permissions.throwPermissionError();
  }

  // Text endpoints inherit this check via parsePrompt; image-gen calls
  // the paid provider directly so we have to enforce it ourselves.
  const { visualEditorImageModel, visualEditorAIContext, aiEnabled } =
    getAISettingsForOrg(context, true);
  if (!aiEnabled) {
    throw new Error(
      "AI features are disabled for this organization. Enable them in Settings → AI Settings.",
    );
  }

  if (await secondsUntilAICanBeUsedAgain(org)) {
    throw new Error(
      "Daily AI usage limit reached. Try again later or upgrade your plan.",
    );
  }

  // Brand context prepended (not appended) — image models weight early
  // prompt text more heavily for style cues.
  const effectivePrompt = visualEditorAIContext
    ? `${visualEditorAIContext}\n\n---\n\n${prompt}`
    : prompt;

  logger.info(
    {
      orgId: org.id,
      userId: context.userId,
      visualChangesetId,
      promptLength: prompt.length,
      aspectRatio: aspectRatio ?? null,
      count,
      model: visualEditorImageModel,
      hasReferenceImage: !!referenceImage,
      referenceImageBytes: referenceImage
        ? Math.floor((referenceImage.data.length * 3) / 4)
        : 0,
      referenceImageMime: referenceImage?.mimeType ?? null,
      hasBrandContext: !!visualEditorAIContext,
      prompt,
    },
    "[visual-editor-ai/image-gen] user prompt",
  );

  const generated = await generateImages({
    context,
    model: visualEditorImageModel,
    prompt: effectivePrompt,
    count,
    aspectRatio,
    referenceImage,
  });

  // Bill BEFORE upload — if the provider returned bytes we paid for them,
  // even if upload fails. Awaited so the quota counter is decremented
  // before we return; try/catch because a transient billing-DB failure
  // shouldn't surface to the user (worst case: one batch under-counted).
  if (generated.length > 0) {
    try {
      await updateTokenUsage({
        organization: org,
        numTokensUsed: IMAGE_GEN_TOKEN_COST_PER_IMAGE * generated.length,
      });
    } catch (err) {
      logger.warn(
        { err, orgId: org.id, count: generated.length },
        "[visual-editor-ai/image-gen] failed to record token usage",
      );
    }
  }

  // Upload to a `gen/` quarantine prefix — the promote endpoint moves
  // accepted images to the permanent location, and the bucket lifecycle
  // policy reaps the rest after 7 days. Top-level `gen/` matters: S3
  // lifecycle filters take a single literal prefix (no globs).
  const images: Array<{ url: string; width: number; height: number }> = [];
  let beforeBytes = 0;
  let afterBytes = 0;
  let unoptimizedCount = 0;
  for (let i = 0; i < generated.length; i++) {
    const img = generated[i];
    // When replacing an existing <img>, the extension sends its exact natural
    // dimensions as `aspectRatio` ("W:H"). Crop the generated image to that
    // aspect so it slots in cleanly instead of being center-cropped/zoomed by
    // the page. Undefined for inserts / background-image targets → plain fit.
    const optimized = await optimizeAIImage(img, { cropToAspect: aspectRatio });
    if (!optimized.optimized) unoptimizedCount++;
    beforeBytes += img.buffer.length;
    afterBytes += optimized.buffer.length;
    const filePath = `gen/${org.id}/visual-editor/img_${uuidv4()}.${optimized.ext}`;
    // If the S3/GCS push fails, uploadFile logs a single rich entry (bucket/
    // region/key + this context) and re-throws, surfacing as an error to the
    // caller — so we deliberately don't catch-and-log again here, which would
    // double-count the same failure.
    const url = await uploadFile(
      filePath,
      optimized.contentType,
      optimized.buffer,
      "visual-editor-assets",
      {
        orgId: org.id,
        userId: context.userId,
        visualChangesetId,
        imageIndex: i,
        totalGenerated: generated.length,
        uploadedSoFar: images.length,
      },
    );
    images.push({
      url,
      width: optimized.width,
      height: optimized.height,
    });
  }

  logger.info(
    {
      orgId: org.id,
      userId: context.userId,
      generated: generated.length,
      uploaded: images.length,
      unoptimizedCount,
      providerBytes: beforeBytes,
      optimizedBytes: afterBytes,
      compressionRatio: beforeBytes
        ? Math.round((afterBytes / beforeBytes) * 100) / 100
        : null,
    },
    "[visual-editor-ai/image-gen] batch summary",
  );

  return { images };
});
