import { Binary } from "mongodb";
import {
  compressLargeText,
  COMPRESS_MIN_LENGTH,
  decompressText,
} from "back-end/src/util/compression";

describe("compressLargeText", () => {
  it("leaves text below the threshold uncompressed", async () => {
    expect(await compressLargeText("x".repeat(COMPRESS_MIN_LENGTH - 1))).toBe(
      null,
    );
  });

  it("stores repeats far apart about once", async () => {
    // Random-ish 200KB value, then 20 copies: beyond snappy's 64KB window.
    const value = Array.from({ length: 20000 }, (_, i) =>
      ((i * 2654435761) % 1e9).toString(36),
    ).join(",");
    const text = Array.from({ length: 20 }, () => value).join("|");
    const single = await compressLargeText(value);
    const repeated = await compressLargeText(text);
    if (!single || !repeated) throw new Error("expected compression");
    expect(repeated.length).toBeLessThan(single.length * 1.2);
    expect(decompressText(repeated)).toBe(text);
  });

  it("decompresses a Binary from a lean read", async () => {
    const text = "é".repeat(COMPRESS_MIN_LENGTH);
    const compressed = await compressLargeText(text);
    if (!compressed) throw new Error("expected compression");
    expect(decompressText(new Binary(compressed))).toBe(text);
  });
});
