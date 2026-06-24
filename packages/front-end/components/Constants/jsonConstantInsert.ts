// Helpers for inserting constant references into a JSON feature value being
// edited. These are pure (text + cursor offset in, edit out) so the cursor-aware
// behavior can be unit-tested without the Ace editor.

export type JsonInsertContext = "string" | "object" | "array" | "none";

// Classify where `offset` sits within `text` (a JSON document mid-edit):
// inside a "string" literal, directly inside an "object"/"array", or "none".
export function getJsonInsertContext(
  text: string,
  offset: number,
): JsonInsertContext {
  let inString = false;
  let escaped = false;
  const stack: ("object" | "array")[] = [];
  for (let i = 0; i < offset && i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[")
      stack.push(ch === "{" ? "object" : "array");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inString) return "string";
  return stack.length ? stack[stack.length - 1] : "none";
}

// Find the index of the closing bracket (`}` or `]`) of the container the
// cursor is directly inside. Returns -1 if not found (malformed). Skips nested
// brackets and string contents.
function findCurrentClose(
  text: string,
  offset: number,
  closeChar: "}" | "]",
): number {
  const otherClose = closeChar === "}" ? "]" : "}";
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (let i = offset; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === otherClose) depth--;
    else if (ch === closeChar) {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

function findCurrentObjectClose(text: string, offset: number): number {
  return findCurrentClose(text, offset, "}");
}

export type ConstantInsertion = { index: number; text: string };

// The leading whitespace (indentation) of the line containing `idx`.
function lineIndent(text: string, idx: number): string {
  let start = idx;
  while (start > 0 && text[start - 1] !== "\n") start--;
  let end = start;
  while (end < text.length && (text[end] === " " || text[end] === "\t")) end++;
  return text.slice(start, end);
}

// Append a new entry just before the object's closing brace `close`: after the
// last existing property (attaching a comma to it) at the existing indentation,
// or as the sole entry for an empty object.
function insertAtObjectClose(
  text: string,
  close: number,
  key: string,
): ConstantInsertion {
  const entry = `"@const:${key}": true`;
  let last = close - 1;
  while (last >= 0 && /\s/.test(text[last])) last--;

  if (last < 0 || text[last] === "{") {
    const closeIndent = lineIndent(text, close);
    return { index: close, text: `\n${closeIndent}  ${entry}\n${closeIndent}` };
  }
  const indent = lineIndent(text, last);
  const needsComma = text[last] !== ",";
  return {
    index: last + 1,
    text: `${needsComma ? "," : ""}\n${indent}${entry}`,
  };
}

// Prepend a new entry right after the object's opening brace `open`: a new line
// at the first property's indentation, with a trailing comma before the existing
// first property (or as the sole entry for an empty object).
function insertAtObjectOpen(
  text: string,
  open: number,
  key: string,
): ConstantInsertion {
  const entry = `"@const:${key}": true`;
  let first = open + 1;
  while (first < text.length && /\s/.test(text[first])) first++;

  if (first >= text.length || text[first] === "}") {
    const openIndent = lineIndent(text, open);
    return {
      index: open + 1,
      text: `\n${openIndent}  ${entry}\n${openIndent}`,
    };
  }
  const indent = lineIndent(text, first);
  return { index: open + 1, text: `\n${indent}${entry},` };
}

// Append the whole-value object `{ "@const:key": true }` as a new array element
// just before the array's closing bracket `close`.
function insertAtArrayClose(
  text: string,
  close: number,
  key: string,
): ConstantInsertion {
  const element = `{ "@const:${key}": true }`;
  let last = close - 1;
  while (last >= 0 && /\s/.test(text[last])) last--;

  if (last < 0 || text[last] === "[") {
    const closeIndent = lineIndent(text, close);
    return {
      index: close,
      text: `\n${closeIndent}  ${element}\n${closeIndent}`,
    };
  }
  const indent = lineIndent(text, last);
  const needsComma = text[last] !== ",";
  return {
    index: last + 1,
    text: `${needsComma ? "," : ""}\n${indent}${element}`,
  };
}

// Build the edit for inserting a JSON constant. The whole-value form
// `{ "@const:key": true }` is the primary one, so an empty document or an array
// context inserts that object; inside an object the `"@const:key": true` entry
// is appended. Forgiving: when the cursor sits just outside an object (only
// whitespace between), it snaps to it — appending past a `}`, prepending past a
// `{`. Returns null when nothing is in reach.
export function buildJsonConstantInsertion(
  text: string,
  offset: number,
  key: string,
): ConstantInsertion | null {
  // Empty/whitespace value → the constant is the entire value.
  if (text.trim() === "") {
    return {
      index: Math.min(offset, text.length),
      text: `{ "@const:${key}": true }`,
    };
  }

  const context = getJsonInsertContext(text, offset);

  if (context === "object") {
    const close = findCurrentObjectClose(text, offset);
    if (close !== -1) return insertAtObjectClose(text, close, key);
  }

  // Inside an array → add the whole-value object as an element.
  if (context === "array") {
    const close = findCurrentClose(text, offset, "]");
    if (close !== -1) return insertAtArrayClose(text, close, key);
  }

  // Nearest non-whitespace char before the caret — append if it's a `}`.
  let before = offset - 1;
  while (before >= 0 && /\s/.test(text[before])) before--;
  if (before >= 0 && text[before] === "}") {
    return insertAtObjectClose(text, before, key);
  }

  // Nearest non-whitespace char at/after the caret — prepend if it's a `{`.
  let after = offset;
  while (after < text.length && /\s/.test(text[after])) after++;
  if (after < text.length && text[after] === "{") {
    return insertAtObjectOpen(text, after, key);
  }

  return null;
}

// Build the edit for inserting a string constant reference into a string
// literal (a keyval value or a string array entry). Forgiving: if the cursor
// isn't strictly inside a string but sits within 2 characters of one (e.g. just
// past a closing quote, as in `"foo",|`), it snaps into that nearest string.
// Returns null when no string is in reach.
export function buildStringRefInsertion(
  text: string,
  offset: number,
  key: string,
): ConstantInsertion | null {
  // Prefer the exact caret, then the closest positions within 2 chars (back
  // before forward) that land inside a string.
  for (const p of [offset, offset - 1, offset + 1, offset - 2, offset + 2]) {
    if (p < 0 || p > text.length) continue;
    if (getJsonInsertContext(text, p) === "string") {
      return { index: p, text: `{{ @const:${key} }}` };
    }
  }
  return null;
}
