// `sharp` is a native module. Importing it at module-load time means
// every test suite that touches anything in back-end/src transitively
// loads it — on CI (Node 24) the native binary fails to initialize and
// 11 test suites crash before any assertion runs. None of those suites
// actually exercise image optimization. Defer the import to the first
// call so the test surface stays unaffected by sharp's availability,
// and so we don't pay the native init cost on cold back-end startup
// for routes that never run the AI image flow.
//
// We cache the dynamic import promise so concurrent first-callers share
// one load. Type-only import (erased at compile time) gives us the
// factory signature without triggering eager native loading.
//
// CJS-vs-ESM interop note: sharp uses `module.exports = sharp` (classic
// CommonJS). Dynamic `import("sharp")` returns a namespace shaped
// `{ default: sharpFn, ...named }` at runtime — but under
// `esModuleInterop` TypeScript may instead type the awaited value as
// just the function. The `.default ?? m` fallback below covers both:
// pick the default export when present, otherwise the module value
// itself is already the callable.
import type sharpType from "sharp";
type SharpFactory = typeof sharpType;
let sharpFactoryPromise: Promise<SharpFactory> | null = null;
const loadSharp = (): Promise<SharpFactory> => {
  if (!sharpFactoryPromise) {
    sharpFactoryPromise = import("sharp").then((m) => {
      const ns = m as unknown as { default?: SharpFactory };
      return ns.default ?? (m as unknown as SharpFactory);
    });
  }
  return sharpFactoryPromise;
};

// Optimize an AI-generated image for the web.
//
// Gemini Nano Banana returns lossless PNGs at the requested aspect-ratio
// dimensions (e.g. 1024×1024 for 1:1). Those PNGs are huge — roughly
// 1 MB for a photo-like 1024×1024 frame, because PNG is lossless and
// photo content has no large flat areas to run-length-encode. Serving
// that to real visitors on a variant means a megabyte of bandwidth per
// page load, terrible Largest Contentful Paint on slow connections,
// and CDN bills that don't match the value.
//
// What we do:
//   1. Downscale to a sane longest-edge cap. Visual-experiment hero
//      images don't benefit from > 1280px on the longest side; retina
//      laptop screens display them at half that physical pixel density.
//      Smaller images are left untouched (`withoutEnlargement: true`).
//   2. Re-encode as WebP at quality 82. WebP gives ~25–30% smaller
//      files than JPEG at equivalent perceived quality, has alpha-
//      channel support (so we don't lose anything vs PNG), and ships
//      on every modern browser (96%+ globally). 82 is the standard
//      sweet spot — visually indistinguishable from the original PNG
//      at typical viewing distances.
//   3. Strip metadata (EXIF, ICC profiles, etc.). Gemini doesn't write
//      much, but a few KB saved is free.
//
// Typical result: ~1 MB PNG → ~80–150 KB WebP. ~10× reduction.
//
// We deliberately don't expose a UI knob for these settings — one
// sensible default covers ~95% of cases, and adding "image quality"
// to the AI gen flow makes the surface more complex without proven
// user demand. A later "high quality" toggle (q≥92, 2048px cap) can
// be added when a real use case appears.

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
  // Dynamic import here (rather than top-level) — see the comment at
  // the top of the file for the test-suite / native-module rationale.
  const sharp = await loadSharp();
  // `sharp(buffer)` auto-detects the source format. `rotate()` honors
  // any EXIF orientation tag before strip — without it, an upright
  // image with a rotation tag would come out sideways post-strip.
  const pipeline = sharp(input)
    .rotate()
    .resize({
      width: MAX_LONGEST_EDGE_PX,
      height: MAX_LONGEST_EDGE_PX,
      fit: "inside", // preserve aspect ratio, fit within the box
      withoutEnlargement: true, // never upscale — Gemini sometimes returns
      //                            smaller-than-requested images and we'd
      //                            rather keep the original pixels than
      //                            blow them up.
    })
    .webp({
      quality: WEBP_QUALITY,
      // `effort: 4` balances encode speed vs compression ratio.
      // Default is 4; setting explicitly so future sharp upgrades
      // don't silently shift our output size if the default changes.
      effort: 4,
    });

  // `withMetadata({})` keeps orientation but strips everything else.
  // We've already baked orientation into the pixels via .rotate(), so
  // we don't need to keep metadata at all.
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    contentType: "image/webp",
    ext: "webp",
    width: info.width,
    height: info.height,
  };
}
