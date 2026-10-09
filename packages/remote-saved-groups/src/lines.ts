import { MAX_ID_LENGTH } from "./constants";
import { toRemoteGroupKey } from "./keys";
import { RemoteGroupCsvOptions } from "./types";

export type LineResult = { id: string } | { skip: true } | { error: string };

const MORE_THAN_ONE_COLUMN =
  "has more than one column. Upload one ID per line.";

/**
 * The value of a line that starts with a quote, or null if the line has more
 * than one field. Inside quotes `""` is an escaped quote; after the closing
 * quote only whitespace may follow.
 */
function readQuotedField(line: string): string | null {
  let value = "";
  for (let i = 1; i < line.length; i++) {
    if (line[i] !== '"') {
      value += line[i];
    } else if (line[i + 1] === '"') {
      value += '"';
      i++;
    } else {
      return line.slice(i + 1).trim() ? null : value;
    }
  }
  // No closing quote
  return null;
}

export function checkLine(
  line: string,
  { attributeKey, numeric }: RemoteGroupCsvOptions,
  isFirstLine: boolean,
): LineResult {
  let id = (isFirstLine ? line.replace(/^\uFEFF/, "") : line).trim();
  if (id.startsWith('"')) {
    const value = readQuotedField(id);
    if (value === null) return { error: MORE_THAN_ONE_COLUMN };
    id = value.trim();
  } else if (/[,;\t]/.test(id)) {
    return { error: MORE_THAN_ONE_COLUMN };
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

/** Bytes needed to recognize a zip file. */
export const BINARY_SIGNATURE_BYTES = 4;

/**
 * Whether a file starts with a zip signature, as spreadsheets (.xlsx) do:
 * "PK" then 03 04, 05 06 or 07 08. An ID like "PK123" isn't one.
 */
export function startsLikeBinary(bytes: Uint8Array): string | null {
  const isZip =
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 3 && bytes[3] === 4) ||
      (bytes[2] === 5 && bytes[3] === 6) ||
      (bytes[2] === 7 && bytes[3] === 8));
  return isZip
    ? "This looks like a spreadsheet or zip file. Upload a CSV with one ID per line."
    : null;
}

export const NOT_TEXT =
  "This is not a text file. Upload a CSV with one ID per line.";
