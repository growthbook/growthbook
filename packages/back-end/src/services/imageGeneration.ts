import { generateImage, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import {
  getImageModelMeta,
  resolveImageModelIdForSdk,
  type AIImageModelMeta,
} from "shared/ai";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";

// Unified image-generation entrypoint. Replaces the Gemini-only HTTP code
// that previously lived in postAIImageGen.ts. Dispatches between two
// flavors:
//
//   1. Dedicated text-to-image endpoint (Imagen, DALL-E, GPT Image,
//      Grok Image) → Vercel AI SDK's `generateImage(provider.image(id))`.
//   2. Multimodal language model that emits image bytes (Gemini 2.5/3
//      *-image-preview) → `generateText(provider(id))` with
//      `responseModalities: ['IMAGE']`, then read `result.files`.
//
// Reference image support is currently gated on the multimodal-text path
// because the SDK's `generateImage` doesn't expose a uniform image-input
// parameter across providers — see AIImageModelMeta.supportsReferenceImage.

export interface GeneratedImage {
  buffer: Buffer;
  contentType: string;
  ext: string;
  width: number;
  height: number;
}

export interface ReferenceImagePart {
  // Raw base64 (no `data:...;base64,` prefix). Decoded by the helper
  // before being handed to the SDK.
  data: string;
  mimeType: string;
}

export interface GenerateImagesParams {
  context: ReqContext | ApiReqContext;
  // SDK / canonical model id, as stored in the org's
  // visualEditorImageModel setting. Legacy aliases (e.g. the bare
  // `gemini-2.5-flash-image`) are normalized internally.
  model: string;
  prompt: string;
  count: number;
  // Provider-agnostic ratio string like "1:1" or "16:9". The helper
  // translates to whatever each SDK expects.
  aspectRatio?: string;
  // Optional reference image — only honored for models whose
  // AIImageModelMeta.supportsReferenceImage is true.
  referenceImage?: ReferenceImagePart;
}

// Approximate output pixel dimensions returned alongside each image so
// the side panel can size <img> tags before the actual bytes load. We
// don't get reliable dims from every SDK response, so this is an upper
// bound used purely for layout. Sharp re-encoding downstream may
// downscale these without changing the layout meaningfully.
const ASPECT_TO_DIMS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "4:3": { width: 1024, height: 768 },
  "3:4": { width: 768, height: 1024 },
};

const SUPPORTED_ASPECTS = Object.keys(ASPECT_TO_DIMS);

// Snap an arbitrary ratio string to the closest supported value. Logs
// silently and defaults to 1:1 for unparseable input.
function snapAspectRatio(input: string | undefined): {
  value: string;
  width: number;
  height: number;
} {
  if (input && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(input)) {
    const [w, h] = input.split(":").map(Number);
    if (w > 0 && h > 0) {
      const want = w / h;
      let best = SUPPORTED_ASPECTS[0];
      let bestDelta = Math.abs(
        Math.log(
          want / (ASPECT_TO_DIMS[best].width / ASPECT_TO_DIMS[best].height),
        ),
      );
      for (const ar of SUPPORTED_ASPECTS) {
        const ratio = ASPECT_TO_DIMS[ar].width / ASPECT_TO_DIMS[ar].height;
        const delta = Math.abs(Math.log(want / ratio));
        if (delta < bestDelta) {
          best = ar;
          bestDelta = delta;
        }
      }
      return { value: best, ...ASPECT_TO_DIMS[best] };
    }
  }
  return { value: "1:1", ...ASPECT_TO_DIMS["1:1"] };
}

// Build the right provider factory for a given model. Wraps
// getAISettingsForOrg so the per-org API keys (configured in AI Settings)
// flow through one place — the image path now uses the SAME key as text
// for each provider, matching how getAIProviderClass works.
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
    throw new Error("AI is not enabled for this organization.");
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

// Best-effort mime type → file extension. Sharp downstream re-encodes to
// webp regardless, so this is mainly a placeholder during the brief
// window between bytes-in-hand and sharp invocation.
function mimeToExt(mime: string): string {
  if (/png/i.test(mime)) return "png";
  if (/jpe?g/i.test(mime)) return "jpg";
  if (/gif/i.test(mime)) return "gif";
  if (/webp/i.test(mime)) return "webp";
  return "bin";
}

// ----------------------------------------------------------------------------
// Image-endpoint path: Imagen / DALL-E / GPT Image / Grok Image
// ----------------------------------------------------------------------------
async function generateViaImageEndpoint(
  params: GenerateImagesParams,
  meta: AIImageModelMeta,
  aspect: { value: string; width: number; height: number },
): Promise<GeneratedImage[]> {
  const { context, model, prompt, count } = params;
  if (params.referenceImage) {
    // Dedicated image endpoints don't accept image inputs through the
    // SDK's generateImage call; OpenAI's edit/variation flows are a
    // separate API surface that the SDK doesn't unify. Fail loudly so
    // the side panel surfaces a clear error rather than silently
    // ignoring the reference and producing an unrelated image.
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

// ----------------------------------------------------------------------------
// Multimodal-text path: Gemini 2.5 / 3 *-image-preview
// ----------------------------------------------------------------------------
async function generateViaMultimodalText(
  params: GenerateImagesParams,
  meta: AIImageModelMeta,
  aspect: { value: string; width: number; height: number },
): Promise<GeneratedImage[]> {
  const { context, model, prompt, count, referenceImage } = params;
  const provider = getImageProvider(context, meta);
  const sdkModelId = resolveImageModelIdForSdk(model);
  // The text-with-image-output Gemini models don't accept `n` — to get
  // multiple variations we fire `count` parallel calls. settle-all so a
  // single transient failure doesn't waste the others.
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType: string }
  > = [];
  if (referenceImage) {
    // Decode base64 → Uint8Array. Multimodal models treat the image part
    // as additional context for the prompt.
    userContent.push({
      type: "image",
      image: Buffer.from(referenceImage.data, "base64"),
      mediaType: referenceImage.mimeType,
    });
  }
  userContent.push({ type: "text", text: prompt });

  const callOnce = async (): Promise<GeneratedImage[]> => {
    const result = await generateText({
      model: (provider as ReturnType<typeof createGoogleGenerativeAI>)(
        sdkModelId,
      ),
      messages: [{ role: "user", content: userContent }],
      providerOptions: {
        google: {
          // Tell Gemini to emit IMAGE parts. Without this it returns a
          // text description of what it would draw, which is useless
          // for our flow.
          responseModalities: ["IMAGE"],
          // For models that support it (e.g. gemini-3-pro-image-preview),
          // a structured aspect hint. Older preview models ignore this.
          imageConfig: { aspectRatio: aspect.value },
        },
      },
    });
    // SDK's result.files holds the image parts.
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
    Array.from({ length: count }, () => callOnce()),
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

// ----------------------------------------------------------------------------
// Public entrypoint
// ----------------------------------------------------------------------------
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
  const aspect = snapAspectRatio(params.aspectRatio);
  if (meta.kind === "image-endpoint") {
    return generateViaImageEndpoint(params, meta, aspect);
  }
  return generateViaMultimodalText(params, meta, aspect);
}
