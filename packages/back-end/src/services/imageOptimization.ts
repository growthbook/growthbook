// `sharp` is a native module. Eager import crashes 11 test suites on
// CI (Node 24) where the native binary fails to initialize. Defer the
// import so unrelated tests don't load it.
//
// The `.default ?? m` fallback below handles both CJS (`module.exports =
// sharp`) and esModuleInterop typings of the dynamic-import result.
import type sharpType from "sharp";
type SharpFactory = typeof sharpType;
let sharpFactoryPromise: Promise<SharpFactory> | null = null;
const loadSharp = (): Promise<SharpFactory> => {
  if (!sharpFactoryPromise) {
    sharpFactoryPromise = import("sharp")
      .then((m) => {
        const ns = m as unknown as { default?: SharpFactory };
        return ns.default ?? (m as unknown as SharpFactory);
      })
      .catch((e) => {
        // Don't cache the rejection. Otherwise a transient load failure
        // would disable optimization for the whole process lifetime. Reset
        // so the next call retries — once sharp loads, optimization resumes
        // automatically with no restart needed.
        sharpFactoryPromise = null;
        throw e;
      });
  }
  return sharpFactoryPromise;
};

// Downscale AI-generated images to a sane longest-edge cap and
// re-encode as WebP. Gemini returns ~1 MB lossless PNGs; this yields
// ~80–150 KB WebP (~10× reduction) with no perceptible quality loss.

const MAX_LONGEST_EDGE_PX = 1280;
const WEBP_QUALITY = 82;

export interface OptimizedImage {
  buffer: Buffer;
  contentType: "image/webp";
  ext: "webp";
  width: number;
  height: number;
}

export async function optimizeAIImage(input: Buffer): Promise<OptimizedImage> {
  const sharp = await loadSharp();
  // `.rotate()` bakes EXIF orientation into pixels before metadata strip.
  const pipeline = sharp(input)
    .rotate()
    .resize({
      width: MAX_LONGEST_EDGE_PX,
      height: MAX_LONGEST_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({
      quality: WEBP_QUALITY,
      // Pin to sharp's current default so future upgrades don't shift
      // our output size silently.
      effort: 4,
    });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    contentType: "image/webp",
    ext: "webp",
    width: info.width,
    height: info.height,
  };
}
