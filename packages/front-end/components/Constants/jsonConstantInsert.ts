// Helpers for inserting constant references into a JSON feature value being
// edited. Pure (text in, edit/result out) so the behavior can be unit-tested
// without the Ace editor.
import type { Ace } from "ace-builds";
import { formatJsonMultilineObjects } from "shared/util";
import { CONSTANT_EXTENDS_KEY } from "shared/constants";

export type JsonInsertContext = "string" | "key" | "object" | "array" | "none";

// Classify where `offset` sits within `text` (a JSON document mid-edit):
// inside a string-literal value ("string"), inside an object KEY ("key" —
// never a valid insertion point), directly inside an "object"/"array", or
// "none".
export function getJsonInsertContext(
  text: string,
  offset: number,
): JsonInsertContext {
  let inString = false;
  let stringIsKey = false;
  let escaped = false;
  // For objects, `expectingKey` tracks whether the next string opens a key
  // (true after `{` or `,`, false once the pending pair's `:` is seen).
  const stack: { type: "object" | "array"; expectingKey?: boolean }[] = [];
  for (let i = 0; i < offset && i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    const top = stack[stack.length - 1];
    if (ch === '"') {
      inString = true;
      stringIsKey = top?.type === "object" && top.expectingKey !== false;
    } else if (ch === "{") stack.push({ type: "object", expectingKey: true });
    else if (ch === "[") stack.push({ type: "array" });
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === ":" && top?.type === "object") top.expectingKey = false;
    else if (ch === "," && top?.type === "object") top.expectingKey = true;
  }
  if (inString) return stringIsKey ? "key" : "string";
  return stack.length ? stack[stack.length - 1].type : "none";
}

// `text` replaces `index` to `end`; the two are equal for a plain insert.
export type ConstantInsertion = { index: number; end: number; text: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Add a JSON (object) constant reference to the value's `$extends` array,
// creating the array if absent and de-duping. Returns the full re-serialized
// value (one key/element per line), or null when the current text isn't an
// editable JSON object — mid-edit invalid JSON, or an array/primitive root —
// in which case the caller treats it as "insert failed". JSON constants are
// always objects, so they're composed by extending, not whole-value swapped.
export function addJsonConstantExtends(
  text: string,
  key: string,
): string | null {
  const ref = `@const:${key}`;
  const trimmed = text.trim();

  let obj: Record<string, unknown>;
  if (trimmed === "") {
    obj = {};
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (!isPlainObject(parsed)) return null;
    obj = parsed;
  }

  // Keep all existing entries — string refs AND inline-object layers (the
  // advanced `$extends` escape hatch the resolver/validator support); only the
  // new string ref is de-duped. Filtering to strings here would silently drop
  // those inline-object layers.
  const existing = obj[CONSTANT_EXTENDS_KEY];
  const refs: unknown[] = Array.isArray(existing) ? [...existing] : [];
  if (!refs.includes(ref)) refs.push(ref);

  // Keep `$extends` first so the merge base reads top-to-bottom; preserve the
  // order of the remaining keys.
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === CONSTANT_EXTENDS_KEY) continue;
    rest[k] = v;
  }
  return formatJsonMultilineObjects({ [CONSTANT_EXTENDS_KEY]: refs, ...rest });
}

// Where a reference goes in a string literal (a keyval value or a string
// array entry). Forgiving: if the cursor isn't strictly inside a string but
// sits within 2 characters of one (e.g. just past a closing quote, as in
// `"foo",|`), it snaps into that nearest string. Null when none is in reach.
function stringInsertIndex(text: string, offset: number): number | null {
  // Prefer the exact caret, then the closest positions within 2 chars (back
  // before forward) that land inside a string.
  for (const p of [offset, offset - 1, offset + 1, offset - 2, offset + 2]) {
    if (p < 0 || p > text.length) continue;
    if (getJsonInsertContext(text, p) === "string") return p;
  }
  return null;
}

// The span a new value replaces at `offset`: empty where one can start (after
// a key's colon or at an array element), or a `null` at the cursor.
function valueSlot(text: string, offset: number): [number, number] | null {
  const gap = text.slice(offset).length - text.slice(offset).trimStart().length;
  const nullStart = [
    offset + gap,
    offset - 1,
    offset - 2,
    offset - 3,
    offset - 4,
  ].find(
    (s) =>
      s >= 0 &&
      /^null(?!\w)/.test(text.slice(s)) &&
      !/\w/.test(text[s - 1] ?? ""),
  );
  const [start, end] =
    nullStart === undefined ? [offset, offset] : [nullStart, nullStart + 4];
  const context = getJsonInsertContext(text, start);
  const before = text.slice(0, start).trimEnd().slice(-1);
  const opens =
    context === "object"
      ? before === ":"
      : context === "array" && (before === "[" || before === ",");
  const after = text.slice(end).trimStart()[0];
  return opens && (after === undefined || ",}]".includes(after))
    ? [start, end]
    : null;
}

// The edit that puts `ref` in a string: inside the one at the cursor, or as a
// new quoted value where one can start (`"auth": |`, `"auth": |null`).
export function buildRefInsertion(
  text: string,
  offset: number,
  ref: string,
): ConstantInsertion | null {
  const index = stringInsertIndex(text, offset);
  if (index !== null) return { index, end: index, text: ref };
  const slot = valueSlot(text, offset);
  return slot ? { index: slot[0], end: slot[1], text: `"${ref}"` } : null;
}

// Makes that edit at the editor's cursor. False when the reference has
// nowhere to go.
export function insertRefAtCursor(editor: Ace.Editor, ref: string): boolean {
  const doc = editor.session.doc;
  const insertion = buildRefInsertion(
    editor.getValue(),
    doc.positionToIndex(editor.getCursorPosition()),
    ref,
  );
  if (!insertion) return false;
  const start = doc.indexToPosition(insertion.index, 0);
  const end = doc.indexToPosition(insertion.end, 0);
  const range = editor.getSelectionRange();
  range.setStart(start.row, start.column);
  range.setEnd(end.row, end.column);
  editor.session.replace(range, insertion.text);
  editor.focus();
  return true;
}
