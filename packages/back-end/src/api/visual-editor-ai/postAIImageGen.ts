import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { uploadFile } from "back-end/src/services/files";
import { optimizeAIImage } from "back-end/src/services/imageOptimization";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { secondsUntilAICanBeUsedAgain } from "back-end/src/enterprise/services/ai";
import { updateTokenUsage } from "back-end/src/models/AITokenUsageModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { fetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";
import { GEMINI_API_KEY } from "back-end/src/util/secrets";
import { requireUserAuth } from "./requireUserAuth";

// Token-equivalent cost charged against the org's daily AI budget per
// successfully generated image. Gemini bills image output at ~1290
// tokens/image (per Google's published pricing), so we mirror that
// value here — generating one image consumes roughly the same daily
// budget as a small text completion. Without this billing, image-gen
// would bypass the daily cap entirely (the cap counter is only
// incremented by parsePrompt, which image-gen doesn't go through),
// and a single API key could burn unlimited Gemini calls (real $$$).
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
    // with read access could burn paid Gemini calls + write to S3.
    visualChangesetId: z.string(),
    // Optional reference image — when present, Gemini uses it as
    // context for the generation ("edit this image" / "make variations").
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

interface GeneratedImage {
  buffer: Buffer;
  contentType: string;
  ext: string;
  width: number;
  height: number;
}

// Gemini's image-gen accepts a fixed set of aspect ratios. Anything we
// receive from the client is snapped to the closest supported value by
// W/H ratio. Default to 1:1 when nothing is provided. Plain array type
// (not `as const`) so reassigning `best` across entries inside the loop
// stays valid — `as const` would over-narrow each entry to its literal.
const GEMINI_ASPECT_RATIOS: { value: string; ratio: number }[] = [
  { value: "1:1", ratio: 1 },
  { value: "16:9", ratio: 16 / 9 },
  { value: "9:16", ratio: 9 / 16 },
  { value: "4:3", ratio: 4 / 3 },
  { value: "3:4", ratio: 3 / 4 },
];

// Approximate output dimensions for each supported aspect — Gemini doesn't
// let us request exact pixels, so we just record what the side panel will
// see as the natural size. The picker downstream uses these for CSS sizing.
const GEMINI_DIMS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "4:3": { width: 1024, height: 768 },
  "3:4": { width: 768, height: 1024 },
};

function snapAspectRatio(input: string | undefined): {
  value: string;
  width: number;
  height: number;
} {
  if (input && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(input)) {
    const [w, h] = input.split(":").map(Number);
    if (w > 0 && h > 0) {
      const want = w / h;
      let best = GEMINI_ASPECT_RATIOS[0];
      let bestDelta = Math.abs(Math.log(want / best.ratio));
      for (const ar of GEMINI_ASPECT_RATIOS) {
        const delta = Math.abs(Math.log(want / ar.ratio));
        if (delta < bestDelta) {
          best = ar;
          bestDelta = delta;
        }
      }
      return { value: best.value, ...GEMINI_DIMS[best.value] };
    }
  }
  return { value: "1:1", ...GEMINI_DIMS["1:1"] };
}

// Narrow shape we read from Gemini's generateContent response. The full
// schema is rich (citations, safety, etc.) but we only need the inline
// image bytes here.
type GeminiPart = {
  inlineData?: { mimeType?: string; data?: string };
};
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; code?: number; status?: string };
};

// Cache the model-list lookup per process — it only runs when we 404 and
// we don't want to spam Google's models endpoint on every failed call.
let cachedAvailableImageModels: string[] | null = null;

async function listAvailableImageModels(): Promise<string[]> {
  if (cachedAvailableImageModels) return cachedAvailableImageModels;
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models",
      { headers: { "x-goog-api-key": GEMINI_API_KEY } },
    );
    if (!res.ok) return [];
    const j = (await res.json()) as {
      models?: {
        name?: string;
        supportedGenerationMethods?: string[];
      }[];
    };
    // Filter to models that look like image generators: names contain
    // "image" or "imagen", AND they support generateContent.
    const candidates = (j.models ?? [])
      .filter(
        (m) =>
          m.supportedGenerationMethods?.includes("generateContent") &&
          /image|imagen/i.test(m.name ?? ""),
      )
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean);
    cachedAvailableImageModels = candidates;
    return candidates;
  } catch (e) {
    logger.warn({ err: e }, "[visual-editor-ai] listModels failed");
    return [];
  }
}

interface ReferenceImagePart {
  data: string; // base64
  mimeType: string;
}

async function callGeminiOnce(
  prompt: string,
  aspectRatio: string,
  model: string,
  referenceImage?: ReferenceImagePart,
): Promise<{ buffer: Buffer; contentType: string; ext: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  // Build the parts array for the Gemini *request*. Gemini's multimodal
  // pattern is image first, then text — we mirror their canonical
  // ordering for predictability. Named `requestParts` to avoid shadowing
  // the same-named local further down where we parse Gemini's response.
  const requestParts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];
  if (referenceImage) {
    requestParts.push({
      inlineData: {
        mimeType: referenceImage.mimeType,
        data: referenceImage.data,
      },
    });
  }
  requestParts.push({ text: prompt });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Header auth keeps the key out of the request line and out of any
      // upstream proxy access logs.
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: requestParts }],
      generationConfig: {
        // Tell Gemini we want image bytes back, not a textual description.
        // IMAGE-only keeps the response small; some sites also like TEXT
        // for captions but we don't need it.
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Surface Gemini's structured error when present so the side panel can
    // show something actionable (rate limit, content blocked, etc.).
    let detail = text;
    try {
      const j = JSON.parse(text) as GeminiResponse;
      if (j.error?.message) detail = j.error.message;
    } catch {
      // not JSON — keep the raw text
    }
    // 404 typically means the model ID is wrong for this key — Google's
    // model names change between preview/stable releases. Auto-list what
    // IS available so the user doesn't have to debug blind.
    if (res.status === 404) {
      const available = await listAvailableImageModels();
      const hint =
        available.length > 0
          ? ` Available image models on this key: ${available.join(", ")}. Set the visual editor image model in Settings → AI Settings (or the GEMINI_IMAGE_MODEL env var) to one of those.`
          : " Run `curl 'https://generativelanguage.googleapis.com/v1beta/models' -H 'x-goog-api-key: $GEMINI_API_KEY'` to list models for your account.";
      throw new Error(
        `Gemini image gen failed (404): model "${model}" not found.${hint}`,
      );
    }
    throw new Error(
      `Gemini image gen failed (${res.status}): ${detail.slice(0, 300)}`,
    );
  }

  const json = (await res.json()) as GeminiResponse;
  if (json.promptFeedback?.blockReason) {
    // Safety filter tripped — bubble it up so the user knows to rephrase.
    throw new Error(
      `Gemini blocked the prompt: ${json.promptFeedback.blockReason}`,
    );
  }
  // Walk parts looking for inline image data. Gemini may return multiple
  // parts (e.g. text + image); take the first inline image we see.
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find((p) => p.inlineData?.data);
  if (!imgPart?.inlineData?.data) {
    throw new Error(
      "Gemini returned no image — possibly filtered or empty response",
    );
  }

  const buffer = Buffer.from(imgPart.inlineData.data, "base64");
  const mime = imgPart.inlineData.mimeType || "image/png";
  // Gemini returns PNG by default; map MIME → extension for the S3 key.
  const ext =
    mime === "image/jpeg" || mime === "image/jpg"
      ? "jpg"
      : mime === "image/webp"
        ? "webp"
        : "png";
  return { buffer, contentType: mime, ext };
}

/**
 * Generate N images from a text prompt via Gemini (Nano Banana).
 *
 * One API call per image — Gemini 2.5 Flash Image returns one image per
 * `generateContent` call. We fire `count` calls in parallel and tolerate
 * partial failure: if some calls succeed we return what we have rather
 * than rejecting the whole batch. That mirrors how a user would use the
 * UI: they want options to pick from.
 */
async function generateImages(
  prompt: string,
  count: number,
  aspectRatio: string | undefined,
  model: string,
  referenceImage?: ReferenceImagePart,
): Promise<GeneratedImage[]> {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "Image generation is not configured (set GEMINI_API_KEY on the back-end).",
    );
  }

  const { value: aspect, width, height } = snapAspectRatio(aspectRatio);

  // Settle-all so a single transient failure (rate limit on one of the
  // parallel calls) doesn't waste the others.
  const settled = await Promise.allSettled(
    Array.from({ length: count }, () =>
      callGeminiOnce(prompt, aspect, model, referenceImage),
    ),
  );

  const out: GeneratedImage[] = [];
  const errors: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") {
      out.push({ ...r.value, width, height });
    } else {
      errors.push(
        r.reason instanceof Error ? r.reason.message : String(r.reason),
      );
    }
  }

  if (out.length === 0) {
    // All calls failed — surface the first error so the side panel shows
    // something useful. The rest go to the logs for ops triage.
    if (errors.length > 1) {
      logger.warn(
        { extraErrors: errors.slice(1) },
        "[visual-editor-ai] additional Gemini failures",
      );
    }
    throw new Error(errors[0] || "Gemini image generation failed");
  }

  if (errors.length > 0) {
    logger.warn(
      { errors, returned: out.length, requested: count },
      "[visual-editor-ai] Gemini image gen partial success",
    );
  }

  return out;
}

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
  // parsePrompt; image-gen calls Gemini directly so we have to enforce
  // it ourselves. Without this, an org that has explicitly disabled
  // AI features can still call image-gen and incur real Gemini cost.
  const { visualEditorImageModel, visualEditorAIContext, aiEnabled } =
    getAISettingsForOrg(context, true);
  if (!aiEnabled) {
    throw new Error(
      "AI features are disabled for this organization. Enable them in Settings → AI Settings.",
    );
  }

  // Image gen is on the paid path (Gemini). Honor the same daily-usage
  // ceiling the text endpoints already enforce so a single key can't
  // run an unbounded loop of generations. We BILL the cost after the
  // gen succeeds (see updateTokenUsage call below) so failed calls
  // don't drain the budget — consistent with parsePrompt's behavior.
  if (await secondsUntilAICanBeUsedAgain(org)) {
    throw new Error(
      "Daily AI usage limit reached. Try again later or upgrade your plan.",
    );
  }

  // We also pull the org's brand-guidelines context — same value used
  // by postAIEdit — and prepend it to the user's prompt so generated
  // images respect the org's visual identity (palette, tone, etc.).
  // Prepended rather than appended because Gemini weights early prompt
  // text more heavily for style cues.
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

  const generated = await generateImages(
    effectivePrompt,
    count,
    aspectRatio,
    visualEditorImageModel,
    referenceImage,
  );

  // Bill the org's daily AI budget for the images that successfully
  // generated. We do this BEFORE upload (the upload + optimization
  // steps below have their own failure modes that we don't want to
  // bypass billing for — if the image came back from Gemini, we paid
  // for it). Failed images in the batch (Gemini errored, rate limit,
  // etc.) aren't billed because they're not in `generated`.
  //
  // We AWAIT the write so the quota counter is reliably decremented
  // before we return — otherwise a fast follow-up request could read
  // a stale counter and slip past the daily cap. We still wrap it in
  // try/catch: the images are already generated (and already cost us
  // at Gemini), so a transient billing-DB failure shouldn't surface
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

  // Optimize each image before upload. Gemini returns ~1 MB lossless
  // PNGs by default; optimizeAIImage downscales to a sane longest-edge
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
  // ballpark or drifting up due to a Gemini output format change.
  logger.info(
    {
      orgId: org.id,
      userId: context.userId,
      generated: generated.length,
      uploaded: images.length,
      geminiBytes: beforeBytes,
      optimizedBytes: afterBytes,
      compressionRatio: beforeBytes
        ? Math.round((afterBytes / beforeBytes) * 100) / 100
        : null,
    },
    "[visual-editor-ai/image-gen] batch summary",
  );

  return { images };
});
