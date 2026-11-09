import { promisify } from "util";
import { brotliCompress, brotliDecompressSync, constants } from "zlib";
import { Binary } from "mongodb";

const compress = promisify(brotliCompress);

// Below this, Mongo's own block compression already captures most of the gain.
export const COMPRESS_MIN_LENGTH = 64 * 1024;

// Brotli with a 16MB window, so a large value repeated throughout one document
// is stored about once. Mongo's default snappy only looks back 64KB.
export async function compressLargeText(text: string): Promise<Buffer | null> {
  if (text.length < COMPRESS_MIN_LENGTH) return null;
  return compress(text, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 5,
      [constants.BROTLI_PARAM_LGWIN]: 24,
      [constants.BROTLI_PARAM_SIZE_HINT]: text.length,
    },
  });
}

// Hydrated Mongoose documents return a Buffer; lean reads return a Binary.
export function decompressText(stored: Buffer | Binary): string {
  const buf = Buffer.isBuffer(stored)
    ? stored
    : stored.buffer.subarray(0, stored.position);
  return brotliDecompressSync(buf).toString();
}
