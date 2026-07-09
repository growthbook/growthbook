import { generateImage, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import {
  getImageModelMeta,
  resolveImageModelIdForSdk,
  snapAspectRatio,
  aspectRatioToDims,
  buildImageAspectInstruction,
  type AIImageModelMeta,
} from "shared/ai";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";

// Unified image-generation entrypoint. Dispatches between dedicated
// text-to-image endpoints and multimodal language models that emit
// image bytes. Reference images are only supported on the multimodal
// path — see AIImageModelMeta.supportsReferenceImage.

export interface GeneratedImage {
  buffer: Buffer;
  contentType: string;
  ext: string;
  width: number;
  height: number;
}

export interface ReferenceImagePart {
  // Raw base64, no `data:...;base64,` prefix.
  data: string;
  mimeType: string;
}

export interface GenerateImagesParams {
  context: ReqContext | ApiReqContext;
  // SDK / canonical model id. Legacy aliases are normalized internally.
  model: string;
  prompt: string;
  count: number;
  // Provider-agnostic ratio string like "1:1" or "16:9".
  aspectRatio?: string;
  // Only honored when AIImageModelMeta.supportsReferenceImage is true.
  referenceImage?: ReferenceImagePart;
}

// Resolve the generation aspect ratio for a model: snap the requested ratio
// to the closest shape the model supports, then attach approximate output
// dimensions (a pre-decode layout hint; real dims come from the bytes).
function resolveAspect(
  input: string | undefined,
  meta: AIImageModelMeta,
): { value: string; width: number; height: number } {
  const value = snapAspectRatio(input, meta.supportedAspectRatios);
  return { value, ...aspectRatioToDims(value) };
}

// Build the right provider factory for a given model, using the
// per-org API keys from getAISettingsForOrg.
function getImageProvider(
  context: ReqContext | ApiReqContext,
  meta: AIImageModelMeta,
):
  | ReturnType<typeof createGoogleGenerativeAI>
  | ReturnType<typeof createOpenAI>
  | ReturnType<typeof createXai> {
  const { aiEnabled, googleAPIKey, openAIAPIKey, xaiAPIKey } =
    getAISettingsForOrg(context, true);
  if (!aiEnabled) {
    throw new Error(
      "AI is not enabled for this organization. Visit Settings → AI Settings to enable it.",
    );
  }
  if (meta.provider === "google") {
    if (!googleAPIKey) {
      throw new Error(
        "GOOGLE_AI_API_KEY (or legacy GEMINI_API_KEY) is not set.",
      );
    }
    return createGoogleGenerativeAI({ apiKey: googleAPIKey });
  }
  if (meta.provider === "openai") {
    if (!openAIAPIKey) throw new Error("OPENAI_API_KEY is not set.");
    return createOpenAI({ apiKey: openAIAPIKey });
  }
  if (meta.provider === "xai") {
    if (!xaiAPIKey) throw new Error("XAI_API_KEY is not set.");
    return createXai({ apiKey: xaiAPIKey });
  }
  throw new Error(`Unsupported image provider: ${meta.provider}`);
}

// Best-effort mime type → file extension. Sharp re-encodes to webp
// downstream, so this is a short-lived placeholder.
function mimeToExt(mime: string): string {
  if (/png/i.test(mime)) return "png";
  if (/jpe?g/i.test(mime)) return "jpg";
  if (/gif/i.test(mime)) return "gif";
  if (/webp/i.test(mime)) return "webp";
  return "bin";
}

// Image-endpoint path: Imagen / DALL-E / GPT Image / Grok Image
async function generateViaImageEndpoint(
  params: GenerateImagesParams,
  meta: AIImageModelMeta,
  aspect: { value: string; width: number; height: number },
): Promise<GeneratedImage[]> {
  const { context, model, prompt, count } = params;
  if (params.referenceImage) {
    // The SDK's generateImage doesn't accept image inputs. Fail loudly
    // rather than silently ignoring the reference.
    throw new Error(
      `Model "${model}" does not support reference images. Choose a Gemini *-image-preview model for image-as-context, or generate from a text prompt only.`,
    );
  }
  const provider = getImageProvider(context, meta);
  const sdkModelId = resolveImageModelIdForSdk(model);
  const { images, warnings } = await generateImage({
    model: provider.image(sdkModelId),
    prompt,
    n: count,
    aspectRatio: aspect.value as `${number}:${number}`,
  });
  if (warnings && warnings.length > 0) {
    logger.warn(
      { warnings, model: sdkModelId },
      "[image-gen] provider warnings",
    );
  }
  if (!images || images.length === 0) {
    throw new Error("No images returned from the provider.");
  }
  return images.map((img) => {
    const mime = img.mediaType || "image/png";
    return {
      buffer: Buffer.from(img.uint8Array),
      contentType: mime,
      ext: mimeToExt(mime),
      width: aspect.width,
      height: aspect.height,
    };
  });
}

// Multimodal-text path: Gemini 2.5 / 3 *-image-preview
async function generateViaMultimodalText(
  params: GenerateImagesParams,
  meta: AIImageModelMeta,
  aspect: { value: string; width: number; height: number },
): Promise<GeneratedImage[]> {
  const { context, model, prompt, count, referenceImage } = params;
  const provider = getImageProvider(context, meta);
  const sdkModelId = resolveImageModelIdForSdk(model);
  // The reference image (if any) is the same on every call.
  const baseContent: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType: string }
  > = [];
  if (referenceImage) {
    baseContent.push({
      type: "image",
      image: Buffer.from(referenceImage.data, "base64"),
      mediaType: referenceImage.mimeType,
    });
  }

  // When the user asks for several options at once, nudge each parallel call
  // toward a distinct result — with identical inputs Gemini collapses to near
  // duplicates (especially in img2img). The first call is the faithful take;
  // each subsequent one varies a different lever. Only applied when count > 1.
  const VARIATION_NUDGES = [
    "",
    "\n\nVariation: use a noticeably different composition and camera angle.",
    "\n\nVariation: use a different color palette and lighting mood.",
    "\n\nVariation: take a more minimal, alternative styling approach.",
  ];

  // These Gemini models don't accept `n` — fire `count` parallel calls and
  // settle-all so one transient failure doesn't waste the others.
  const callOnce = async (index: number): Promise<GeneratedImage[]> => {
    const variation = count > 1 ? (VARIATION_NUDGES[index] ?? "") : "";
    const content = [
      ...baseContent,
      { type: "text" as const, text: prompt + variation },
    ];
    const result = await generateText({
      model: (provider as ReturnType<typeof createGoogleGenerativeAI>)(
        sdkModelId,
      ),
      messages: [{ role: "user", content }],
      providerOptions: {
        google: {
          // Without this Gemini returns a text description instead of bytes.
          responseModalities: ["IMAGE"],
          // Only sent to models that honor it (gemini-3-pro-image-preview).
          // gemini-2.5-flash-image ignores it, so we steer shape via the
          // prompt's framing instruction instead.
          ...(meta.honorsAspectRatio
            ? { imageConfig: { aspectRatio: aspect.value } }
            : {}),
        },
      },
    });
    const files = result.files ?? [];
    return files
      .filter((f) => (f.mediaType || "").startsWith("image/"))
      .map((f) => {
        const mime = f.mediaType || "image/png";
        return {
          buffer: Buffer.from(f.uint8Array),
          contentType: mime,
          ext: mimeToExt(mime),
          width: aspect.width,
          height: aspect.height,
        };
      });
  };

  const settled = await Promise.allSettled(
    Array.from({ length: count }, (_, i) => callOnce(i)),
  );

  const out: GeneratedImage[] = [];
  const errors: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") {
      out.push(...r.value);
    } else {
      errors.push(
        r.reason instanceof Error ? r.reason.message : String(r.reason),
      );
    }
  }
  if (out.length === 0) {
    if (errors.length > 1) {
      logger.warn(
        { extraErrors: errors.slice(1), model: sdkModelId },
        "[image-gen] additional multimodal failures",
      );
    }
    throw new Error(errors[0] || `Image generation failed for ${sdkModelId}.`);
  }
  if (errors.length > 0) {
    logger.warn(
      { errors, returned: out.length, requested: count, model: sdkModelId },
      "[image-gen] partial multimodal failure",
    );
  }
  return out;
}

export async function generateImages(
  params: GenerateImagesParams,
): Promise<GeneratedImage[]> {
  const meta = getImageModelMeta(params.model);
  if (!meta) {
    throw new Error(
      `Unknown image model "${params.model}". Update AI Settings or pick a supported model.`,
    );
  }
  if (params.referenceImage && !meta.supportsReferenceImage) {
    throw new Error(
      `Model "${meta.id}" does not support reference images. Choose a Gemini *-image-preview model for image-as-context.`,
    );
  }
  const aspect = resolveAspect(params.aspectRatio, meta);

  // Append a framing/safe-area instruction so the result drops into the
  // original image's slot without the subject being center-cropped. No-op
  // when no slot ratio was requested, or when the model emits the right
  // shape anyway.
  const framing = buildImageAspectInstruction({
    requestedRatio: params.aspectRatio,
    snappedRatio: aspect.value,
    honorsAspectRatio: meta.honorsAspectRatio,
  });
  const effectiveParams = framing
    ? { ...params, prompt: `${params.prompt}${framing}` }
    : params;

  if (meta.kind === "image-endpoint") {
    return generateViaImageEndpoint(effectiveParams, meta, aspect);
  }
  return generateViaMultimodalText(effectiveParams, meta, aspect);
}
