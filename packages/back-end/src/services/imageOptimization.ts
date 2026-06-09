import { logger } from "back-end/src/util/logger";

// We use `wasm-vips` (libvips compiled to WebAssembly) instead of the
// native `sharp` module: same engine and output quality, but it ships its
// `.wasm` inside the npm package — there's no platform binary to install,
// so it loads on any runtime/arch and isn't affected by
// `pnpm install --no-optional` (which strips sharp's optional platform
// binaries and broke image gen in production).
//
// NB: wasm-vips ships type defs that use the legacy `declare module X {}`
// syntax, which our compiler (tsgo) rejects with TS1540 even under
// skipLibCheck. So we deliberately do NOT import its types — we load it
// through a non-literal specifier (TS then treats the dynamic import as
// `any` and never parses the offending `.d.ts`) and type the small slice
// we use locally.

interface VipsImage {
  readonly width: number;
  readonly height: number;
  writeToBuffer(format: string, options?: Record<string, unknown>): Uint8Array;
  delete(): void;
}
interface VipsModule {
  Image: {
    thumbnailBuffer(
      buffer: Uint8Array,
      width: number,
      options?: Record<string, unknown>,
    ): VipsImage;
  };
}
type VipsFactory = (config?: Record<string, unknown>) => Promise<VipsModule>;

// `as string` widens the literal so TS doesn't resolve (and choke on)
// wasm-vips's type definitions for this dynamic import.
const VIPS_SPECIFIER = "wasm-vips" as string;

// Init is async and relatively heavy (instantiates the WebAssembly
// module), so memoize a single instance for the process.
let vipsPromise: Promise<VipsModule> | null = null;
const loadVips = (): Promise<VipsModule> => {
  if (!vipsPromise) {
    vipsPromise = import(VIPS_SPECIFIER).then((m: unknown) => {
      const mod = m as { default?: VipsFactory };
      const factory: VipsFactory = mod.default ?? (m as VipsFactory);
      // `dynamicLibraries: []` skips the optional HEIF/JXL/SVG dynamic
      // `.wasm` modules — we only deal with PNG/JPEG/WebP, which live in
      // the core `vips.wasm`. Avoids loading files we don't need.
      return factory({ dynamicLibraries: [] });
    });
  }
  return vipsPromise;
};

// Downscale AI-generated images to a sane longest-edge cap and
// re-encode as WebP. Gemini returns ~1 MB lossless PNGs; this yields
// ~80–150 KB WebP (~10× reduction) with no perceptible quality loss.

const MAX_LONGEST_EDGE_PX = 1280;
const WEBP_QUALITY = 82;

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
  // false when optimization was skipped (vips failed to load / process)
  // and we're returning the original image untouched.
  optimized: boolean;
}

// Best-effort optimization. If vips can't load or process the image for
// any reason, fall back to uploading the original — larger, but
// functional — rather than failing image generation outright.
export async function optimizeAIImage(
  source: RawImage,
): Promise<OptimizedImage> {
  try {
    const vips = await loadVips();

    // `thumbnailBuffer` is libvips' shrink-on-load resize: it fits the
    // image within the box, preserving aspect ratio, and auto-rotates by
    // EXIF orientation. `size: "down"` prevents upscaling images smaller
    // than the cap (equivalent to sharp's `withoutEnlargement: true`).
    const image = vips.Image.thumbnailBuffer(
      source.buffer,
      MAX_LONGEST_EDGE_PX,
      {
        height: MAX_LONGEST_EDGE_PX,
        size: "down",
      },
    );
    try {
      const data = image.writeToBuffer(".webp", {
        Q: WEBP_QUALITY,
        effort: 4,
        // Drop EXIF/ICC/etc. metadata from the output.
        strip: true,
      });
      return {
        buffer: Buffer.from(data),
        contentType: "image/webp",
        ext: "webp",
        width: image.width,
        height: image.height,
        optimized: true,
      };
    } finally {
      // Free the WASM-side image to avoid leaking emscripten heap memory.
      image.delete();
    }
  } catch (err) {
    logger.warn(
      { err },
      "[image-optimization] vips unavailable; uploading original image unoptimized",
    );
    return {
      buffer: source.buffer,
      contentType: source.contentType,
      ext: source.ext,
      width: source.width,
      height: source.height,
      optimized: false,
    };
  }
}
