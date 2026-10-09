import { MAX_ID_LENGTH } from "./constants";
import { toRemoteGroupKey } from "./keys";
import { RemoteGroupCsvOptions } from "./types";

export type LineResult = { id: string } | { skip: true } | { error: string };

/** Applies the line rules to one decoded line. */
export function checkLine(
  line: string,
  { attributeKey, numeric }: RemoteGroupCsvOptions,
  isFirstLine: boolean,
): LineResult {
  let id = (isFirstLine ? line.replace(/^\uFEFF/, "") : line).trim();
  if (id.length >= 2 && id.startsWith('"') && id.endsWith('"')) {
    id = id.slice(1, -1).replace(/""/g, '"').trim();
  } else if (/[,;\t]/.test(id)) {
    return { error: "has more than one column. Upload one ID per line." };
  }
  if (!id) return { skip: true };
  if (isFirstLine && id.toLowerCase() === attributeKey.toLowerCase()) {
    return { skip: true };
  }
  if (id.length > MAX_ID_LENGTH) {
    return { error: `is longer than ${MAX_ID_LENGTH} characters` };
  }
  if (numeric && !Number.isFinite(Number(id))) {
    return {
      error: `is not a number, but ${attributeKey} is a number attribute`,
    };
  }
  return { id: toRemoteGroupKey(id, numeric) };
}

export function startsLikeBinary(bytes: Uint8Array): string | null {
  // Spreadsheets (.xlsx) and zip files start with "PK"
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return "This looks like a spreadsheet or zip file. Upload a CSV with one ID per line.";
  }
  return null;
}

export const NOT_TEXT =
  "This is not a text file. Upload a CSV with one ID per line.";
