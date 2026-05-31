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

// Token-equivalent cost charged against the org's daily AI budget per
// successfully generated image. Gemini bills image output at ~1290
// tokens/image (per Google's published pricing) and most of the other
// supported providers (DALL-E 3, Imagen 4, gpt-image-1 standard, Grok
// Image) land in roughly the same order of magnitude (~$0.04/image), so
// one shared constant is a reasonable approximation for the daily-cap
// gate. If you mix in a much more expensive model (e.g. gpt-image-1
// `high` quality at ~$0.16/image), revisit this and consider a per-model
// cost table.
const IMAGE_GEN_TOKEN_COST_PER_IMAGE = 1290;

// Reference image accepted as base64 bytes (NOT a URL) so the back-end
// never fetches arbitrary URLs on behalf of the caller — no SSRF surface.
// The extension downloads and base64-encodes the image client-side and
// sends it inline. Capped at ~5 MB raw (~6.7 MB base64) for parity with
// the manual upload size limit; that maps to ~7 MB JSON body which fits
// in the 10 MB cap configured for this endpoint in app.ts.
const referenceImageSchema = z.object({
  // Plain base64 (no `data:...;base64,` prefix). Capped at 8 MB of
  // base64 string length — generous headroom over the ~6.7 MB needed for
  // a 5 MB raw image; rejects payloads that would blow past the body
  // limit before we even decode them.
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
    // Required so we can gate on the same permission as updating the
    // visual change (canUpdateVisualChange). Without this, any API key
    // with read access could burn paid provider calls + write to S3.
    visualChangesetId: z.string(),
    // Optional reference image — when present, the configured image
    // model (must be one that supports it — currently only Gemini
    // *-image-preview variants) uses it as context for the generation
    // ("edit this image" / "make variations").
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
  // Require PAT auth — see requireUserAuth. AI image gen counts against
  // a daily limit and incurs real $$ cost per call; we want every
  // request attributable to a real user.
  requireUserAuth(context);

  if (org.settings?.blockFileUploads) {
    throw new Error("File uploads are disabled for this organization");
  }

  // Permission gate: image gen is an edit operation on a variation, so
  // we gate on the same permission as updating the visual changeset.
  // Loading the changeset first also constrains who can call this — a
  // valid changeset ID for the caller's org is required.
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

  // Resolve AI settings up front so we can gate on `aiEnabled` BEFORE
  // any work. The text endpoints inherit this check transitively via
  // parsePrompt; image-gen calls a paid provider directly so we have to
  // enforce it ourselves. Without this, an org that has explicitly
  // disabled AI features can still call image-gen and incur real cost.
  const { visualEditorImageModel, visualEditorAIContext, aiEnabled } =
    getAISettingsForOrg(context, true);
  if (!aiEnabled) {
    throw new Error(
      "AI features are disabled for this organization. Enable them in Settings → AI Settings.",
    );
  }

  // Image gen is on the paid path. Honor the same daily-usage ceiling
  // the text endpoints already enforce so a single key can't run an
  // unbounded loop of generations. We BILL the cost after the gen
  // succeeds (see updateTokenUsage call below) so failed calls don't
  // drain the budget — consistent with parsePrompt's behavior.
  if (await secondsUntilAICanBeUsedAgain(org)) {
    throw new Error(
      "Daily AI usage limit reached. Try again later or upgrade your plan.",
    );
  }

  // Pull the org's brand-guidelines context — same value used by
  // postAIEdit — and prepend it to the user's prompt so generated
  // images respect the org's visual identity (palette, tone, etc.).
  // Prepended rather than appended because most image models weight
  // early prompt text more heavily for style cues.
  const effectivePrompt = visualEditorAIContext
    ? `${visualEditorAIContext}\n\n---\n\n${prompt}`
    : prompt;

  // Log the full image-gen prompt for debugging + iteration. See the
  // matching log in postAIEdit for rationale around PII / privacy
  // tradeoffs. Reference image is summarised by size + mime — we don't
  // log the bytes themselves (would balloon log size with no debugging
  // value beyond "was there a reference, and how big").
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

  // Delegate to the provider-agnostic generator. It dispatches to
  // either Vercel's generateImage (Imagen / DALL-E / GPT Image / Grok
  // Image) or generateText (Gemini *-image-preview multimodal output)
  // based on the configured model's kind. All provider HTTP, auth,
  // response parsing, and per-provider quirks live behind that boundary.
  const generated = await generateImages({
    context,
    model: visualEditorImageModel,
    prompt: effectivePrompt,
    count,
    aspectRatio,
    referenceImage,
  });

  // Bill the org's daily AI budget for the images that successfully
  // generated. We do this BEFORE upload (the upload + optimization
  // steps below have their own failure modes that we don't want to
  // bypass billing for — if the provider returned bytes, we paid for
  // them). Failed images in the batch aren't billed because they're
  // not in `generated`.
  //
  // We AWAIT the write so the quota counter is reliably decremented
  // before we return — otherwise a fast follow-up request could read
  // a stale counter and slip past the daily cap. We still wrap it in
  // try/catch: the images are already generated (and already cost us
  // upstream), so a transient billing-DB failure shouldn't surface
  // as a user-facing error. Worst case is a single batch under-counted
  // against the cap, which is acceptable.
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

  // Optimize each image before upload. Providers commonly return ~1 MB
  // lossless PNGs; optimizeAIImage downscales to a sane longest-edge
  // cap and re-encodes as WebP at q=82, yielding ~80–150 KB. The image
  // dimensions returned to the client come from the post-optimization
  // pipeline so the side panel's thumbnail layout uses the right
  // aspect ratio.
  //
  // Upload destination is a quarantine prefix (`gen/`). When the user
  // picks one (accepts the corresponding mutation in the side panel),
  // the promote endpoint moves it to the permanent location. Anything
  // left in `gen/` is reaped by the bucket's lifecycle policy (7 days)
  // so we don't accumulate cost from images the user generated,
  // previewed, and never used. The leading top-level `gen/` matters —
  // S3 lifecycle filters by a single literal prefix (no globs), so
  // hoisting `gen/` to the root lets one rule cover all orgs.
  const images: Array<{ url: string; width: number; height: number }> = [];
  let beforeBytes = 0;
  let afterBytes = 0;
  for (const img of generated) {
    const optimized = await optimizeAIImage(img.buffer);
    beforeBytes += img.buffer.length;
    afterBytes += optimized.buffer.length;
    const filePath = `gen/${org.id}/visual-editor/img_${uuidv4()}.${optimized.ext}`;
    const url = await uploadFile(
      filePath,
      optimized.contentType,
      optimized.buffer,
      "visual-editor-assets",
    );
    images.push({
      url,
      width: optimized.width,
      height: optimized.height,
    });
  }

  // Observability: log the compression ratio for the batch so we can
  // see in real traffic whether sizes are landing in the ~100 KB
  // ballpark or drifting up due to an output-format change in a
  // provider.
  logger.info(
    {
      orgId: org.id,
      userId: context.userId,
      generated: generated.length,
      uploaded: images.length,
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
