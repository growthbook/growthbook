/** The on-screen stand-in for a password or generated public key. */
const MASK = "'••••••••'";

/**
 * The displayed SQL and the copyable SQL differ only by whole masked
 * credentials. A highlight that includes a mask should put the real
 * credential on the clipboard. Matching the mask as one span (rather than
 * character by character) keeps quotes inside a password, such as
 * `O'Brien`, from being read as the end of the mask.
 */
export function revealCopiedSelection(
  displayed: string,
  full: string,
  selection: string,
): string | null {
  if (!selection.includes(MASK)) return null;
  const reals = credentialSpans(displayed, full);
  if (!reals) return null;

  let from = 0;
  let revealed: string | null = null;
  while (from <= displayed.length) {
    const at = displayed.indexOf(selection, from);
    if (at === -1) break;
    const masksBefore = countMasks(displayed.slice(0, at));
    const masksInSelection = countMasks(selection);
    const next = applyMasks(
      selection,
      reals.slice(masksBefore, masksBefore + masksInSelection),
    );
    // The same highlight can sit on more than one statement. Only rewrite
    // it when every one of those statements would reveal the same text.
    if (revealed !== null && revealed !== next) return null;
    revealed = next;
    from = at + 1;
  }
  return revealed;
}

/** Each masked credential in `displayed`, in order, as it appears in `full`. */
function credentialSpans(displayed: string, full: string): string[] | null {
  if (!displayed.includes(MASK)) return null;
  return parseSpans(full, displayed.split(MASK), 0);
}

/**
 * `parts` are the pieces of SQL around each mask. They are identical in both
 * strings, so each credential is whatever sits between one part and the next.
 * A credential may itself contain a later part (a password with a semicolon,
 * for instance), so try each later match until the remainder lines up.
 */
function parseSpans(
  full: string,
  parts: string[],
  start: number,
): string[] | null {
  const [head, ...rest] = parts;
  if (head === undefined || !full.startsWith(head, start)) return null;
  const cursor = start + head.length;
  if (rest.length === 0) return cursor === full.length ? [] : null;

  const next = rest[0];
  let search = cursor;
  while (search <= full.length) {
    const found = full.indexOf(next, search);
    if (found === -1) return null;
    const tail = parseSpans(full, rest, found);
    if (tail !== null) return [full.slice(cursor, found), ...tail];
    search = found + 1;
  }
  return null;
}

function countMasks(value: string): number {
  return value.split(MASK).length - 1;
}

function applyMasks(selection: string, reals: string[]): string {
  let index = 0;
  return selection.replaceAll(MASK, () => reals[index++] ?? MASK);
}
