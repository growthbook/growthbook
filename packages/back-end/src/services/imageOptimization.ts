import FormData from "form-data";
import { fetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";
import {
  DISABLE_AI_IMAGE_OPTIMIZATION,
  AI_IMAGE_OPTIMIZATION_TIMEOUT_MS,
  KRAKEN_API_KEY,
  KRAKEN_API_SECRET,
} from "back-end/src/util/secrets";

// AI-generated images are optimized via the Kraken.io API (resize + WebP),

// Downscale to a sane longest-edge cap and re-encode as WebP. Gemini returns
// ~1 MB lossless PNGs; this yields ~80–150 KB WebP with no perceptible loss.
const MAX_LONGEST_EDGE_PX = 1280;
const WEBP_QUALITY = 82;
const KRAKEN_UPLOAD_URL = "https://api.kraken.io/v1/upload";

// Source image as produced by the generation provider. Carries enough
// metadata to upload the original unchanged if optimization is skipped.
export interface RawImage {
  buffer: Buffer;
  contentType: string;
  ext: string;
  width: number;
  height: number;
}

export interface OptimizedImage {
  buffer: Buffer;
  contentType: string;
  ext: string;
  width: number;
  height: number;
  // false when optimization was skipped (disabled, no creds, timed out, or
  // the API errored) and we're returning the original image untouched.
  optimized: boolean;
}

// Minimal slice of Kraken's JSON response (wait:true mode).
interface KrakenResponse {
  success?: boolean;
  kraked_url?: string;
  message?: string;
}

// node-fetch v2's bundled AbortSignal type is incompatible with the global
// AbortController's signal; cast through the fetch wrapper's own init type
// (the same workaround http.util uses) rather than importing node-fetch.
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

// Return the original image untouched (the universal fallback).
function passthrough(source: RawImage): OptimizedImage {
  return {
    buffer: source.buffer,
    contentType: source.contentType,
    ext: source.ext,
    width: source.width,
    height: source.height,
    optimized: false,
  };
}

// Dimensions after a "fit within MAX×MAX, never upscale" resize — the same
// transform we ask Kraken to perform. Kraken's response doesn't return output
// dimensions, and we intentionally don't decode the bytes (that decode is the
// CPU work we're offloading), so we derive them from the source dimensions.
function fitDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > 0 ? Math.min(1, MAX_LONGEST_EDGE_PX / longest) : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function krakenOptimize(source: RawImage): Promise<OptimizedImage> {
  // Bound the whole round-trip; abort both requests if it runs long.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    AI_IMAGE_OPTIMIZATION_TIMEOUT_MS,
  );

  try {
    const form = new FormData();
    form.append(
      "data",
      JSON.stringify({
        auth: { api_key: KRAKEN_API_KEY, api_secret: KRAKEN_API_SECRET },
        // Synchronous mode — the response carries the result URL directly.
        wait: true,
        lossy: true,
        quality: WEBP_QUALITY,
        // Convert to WebP and fit within the box without upscaling.
        webp: true,
        resize: {
          strategy: "fit",
          width: MAX_LONGEST_EDGE_PX,
          height: MAX_LONGEST_EDGE_PX,
        },
      }),
    );
    form.append("upload", source.buffer, {
      filename: `source.${source.ext}`,
      contentType: source.contentType,
    });

    const res = await fetch(KRAKEN_UPLOAD_URL, {
      method: "POST",
      body: form,
      signal: controller.signal as FetchInit["signal"],
    });
    if (!res.ok) {
      throw new Error(`Kraken upload returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as KrakenResponse;
    if (!json.success || !json.kraked_url) {
      throw new Error(
        `Kraken optimization failed: ${json.message || "unknown error"}`,
      );
    }

    // Download the optimized bytes so we can store them in our own bucket.
    const imgRes = await fetch(json.kraked_url, {
      signal: controller.signal as FetchInit["signal"],
    });
    if (!imgRes.ok) {
      throw new Error(`Kraken result download returned HTTP ${imgRes.status}`);
    }
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const { width, height } = fitDimensions(source.width, source.height);
    return {
      buffer,
      contentType: "image/webp",
      ext: "webp",
      width,
      height,
      optimized: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Best-effort optimization. If it's disabled, unconfigured, times out, or the
// API errors, fall back to uploading the original — larger, but functional —
// rather than failing image generation outright.
export async function optimizeAIImage(
  source: RawImage,
): Promise<OptimizedImage> {
  if (DISABLE_AI_IMAGE_OPTIMIZATION || !KRAKEN_API_KEY || !KRAKEN_API_SECRET) {
    return passthrough(source);
  }

  try {
    return await krakenOptimize(source);
  } catch (err) {
    logger.warn(
      { err },
      "[image-optimization] Kraken optimization failed/skipped; uploading original image unoptimized",
    );
    return passthrough(source);
  }
}
