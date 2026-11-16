import { NEWLINE } from "./constants";
import { checkLine, NOT_TEXT, startsLikeBinary } from "./lines";
import { RemoteGroupCsvOptions } from "./types";

/**
 * Checks part of a CSV without reading the rest, for a quick check at upload.
 * `start` and `end` say whether the sample begins or ends the file; otherwise
 * its first or last line may be cut off, so it is skipped. Throws the first
 * problem; returns how many IDs the sample has.
 */
export function checkRemoteGroupCsvSample(
  sample: Uint8Array,
  {
    start,
    end,
    ...options
  }: RemoteGroupCsvOptions & { start: boolean; end: boolean },
): { idCount: number } {
  const describe = (lineIndex: number) =>
    start ? `Line ${lineIndex + 1}` : "A line near the end of the file";

  if (start) {
    const binary = startsLikeBinary(sample);
    if (binary) throw new Error(binary);
  }
  if (sample.includes(0)) throw new Error(NOT_TEXT);

  const lines: Uint8Array[] = [];
  let lineStart = 0;
  for (let i = 0; i <= sample.length; i++) {
    if (i === sample.length || sample[i] === NEWLINE) {
      lines.push(sample.subarray(lineStart, i));
      lineStart = i + 1;
    }
  }
  if (!start) lines.shift();
  if (!end) lines.pop();

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let idCount = 0;
  lines.forEach((bytes, i) => {
    let line: string;
    try {
      line = decoder.decode(bytes);
    } catch {
      throw new Error(`${describe(i)} is not valid UTF-8 text`);
    }
    const result = checkLine(line, options, start && i === 0);
    if ("error" in result) throw new Error(`${describe(i)} ${result.error}`);
    if ("id" in result) idCount++;
  });
  return { idCount };
}
