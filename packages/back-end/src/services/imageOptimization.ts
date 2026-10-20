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

// Downscale to a sane longest-edge cap and re-encode as WebP. 1920 covers
// full-width hero slots at 1x; aspect-honoring/high-res models (Gemini 3 Pro
// Image) can fill it, smaller models are only ever downscaled toward it.
// WebP @82 keeps a 1920px image to a few hundred KB.
const MAX_LONGEST_EDGE_PX = 1920;
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

// Parse a "W:H" aspect string (e.g. "16:9", "800:600") into a width/height
// ratio. Returns null for anything malformed so callers fall back to "fit".
function parseAspectRatio(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(s);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  if (!(w > 0) || !(h > 0)) return null;
  return w / h;
}

// Largest box at `ratio` (w/h) that fits INSIDE the source — so the crop only
// ever downscales, never upscales — then capped to the longest-edge limit.
function cropDimensions(
  sourceWidth: number,
  sourceHeight: number,
  ratio: number,
): { width: number; height: number } {
  let width = sourceWidth;
  let height = Math.round(width / ratio);
  if (height > sourceHeight) {
    height = sourceHeight;
    width = Math.round(height * ratio);
  }
  const longest = Math.max(width, height);
  if (longest > MAX_LONGEST_EDGE_PX) {
    const scale = MAX_LONGEST_EDGE_PX / longest;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

// Read pixel dimensions straight from the image header (no full decode, zero
// dependency). The provider tags generated images with NOMINAL dims (a coarse
// aspect hint, longest edge ~1024), not the real output size, so without this
// the crop/cap would size against 1024 and silently downscale a higher-res
// model's output. Returns null for headers we can't parse; callers fall back
// to the nominal dims. Generated images are PNG (most providers) or JPEG.
function readImageDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 24) return null;

  // PNG: 8-byte signature, then the IHDR chunk with width/height as big-endian
  // uint32 at byte offsets 16 and 20.
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // JPEG: walk the marker segments to the Start-Of-Frame, which carries dims.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      // SOF0-SOF15 carry frame dimensions; DHT(c4)/JPG(c8)/DAC(cc) don't.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      // Standalone markers (SOI/EOI/RSTn/TEM) have no length field.
      if (
        marker === 0xd8 ||
        marker === 0xd9 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        offset += 2;
        continue;
      }
      const segLen = buffer.readUInt16BE(offset + 2);
      if (segLen < 2) return null;
      offset += 2 + segLen;
    }
    return null;
  }

  return null;
}

// Resolve the Kraken resize block + the resulting output dimensions, sizing
// against the source's REAL pixel dimensions (srcWidth/srcHeight).
// When `cropToAspect` is a valid ratio, use Kraken's "crop" strategy
// (resize-to-cover then center-crop) so the output matches the target aspect
// EXACTLY — the generated image then drops into the page's <img> slot without
// the browser center-cropping/zooming it. Downscale only (the box fits inside
// the source). Falls back to plain "fit" when no valid ratio is provided.
// Note: no source-aspect comparison — a ratio equal to the source's still
// goes through "crop" (equivalent result), so add a skip-if-same guard here
// if that ever matters.
function resolveResize(
  srcWidth: number,
  srcHeight: number,
  cropToAspect: string | undefined,
): {
  resize: Record<string, unknown>;
  width: number;
  height: number;
} {
  const ratio = parseAspectRatio(cropToAspect);
  if (ratio) {
    const { width, height } = cropDimensions(srcWidth, srcHeight, ratio);
    return {
      resize: { strategy: "crop", width, height },
      width,
      height,
    };
  }
  const fit = fitDimensions(srcWidth, srcHeight);
  return {
    resize: {
      strategy: "fit",
      width: MAX_LONGEST_EDGE_PX,
      height: MAX_LONGEST_EDGE_PX,
    },
    ...fit,
  };
}

async function krakenOptimize(
  source: RawImage,
  cropToAspect?: string,
): Promise<OptimizedImage> {
  // Bound the whole round-trip; abort both requests if it runs long.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    AI_IMAGE_OPTIMIZATION_TIMEOUT_MS,
  );

  // Size against the REAL generated pixels (the provider only tags nominal
  // ~1024 dims), falling back to those nominal dims if the header won't parse.
  // "crop" to the original slot's aspect (downscale-only) when we know it, so
  // the result drops in without the browser center-cropping it; otherwise a
  // plain "fit" downscale. Output dims are derived here (Kraken doesn't return
  // them).
  const actual = readImageDimensions(source.buffer);
  const srcWidth = actual?.width ?? source.width;
  const srcHeight = actual?.height ?? source.height;
  const {
    resize,
    width: outWidth,
    height: outHeight,
  } = resolveResize(srcWidth, srcHeight, cropToAspect);

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
        // Convert to WebP and resize per resolveResize (crop or fit).
        webp: true,
        resize,
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
    return {
      buffer,
      contentType: "image/webp",
      ext: "webp",
      width: outWidth,
      height: outHeight,
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
  opts?: {
    // "W:H" of the slot the image will fill (the original <img>'s natural
    // dimensions). When set, the result is cropped to this exact aspect so it
    // drops into the slot without browser-side cropping/zooming. Omit for
    // inserts / background-image targets where there's no fixed slot aspect.
    cropToAspect?: string;
  },
): Promise<OptimizedImage> {
  if (DISABLE_AI_IMAGE_OPTIMIZATION || !KRAKEN_API_KEY || !KRAKEN_API_SECRET) {
    return passthrough(source);
  }

  try {
    return await krakenOptimize(source, opts?.cropToAspect);
  } catch (err) {
    logger.warn(
      { err },
      "[image-optimization] Kraken optimization failed/skipped; uploading original image unoptimized",
    );
    return passthrough(source);
  }
}
