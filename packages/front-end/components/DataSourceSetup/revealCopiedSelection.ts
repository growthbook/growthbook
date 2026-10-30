/**
 * The displayed SQL and the copyable SQL differ by one span (a masked
 * password or public key). A highlight that includes that span should still
 * put the real value on the clipboard.
 */
export function revealCopiedSelection(
  displayed: string,
  full: string,
  selection: string,
): string | null {
  let start = 0;
  const shared = Math.min(displayed.length, full.length);
  while (start < shared && displayed[start] === full[start]) start += 1;
  let endDisplayed = displayed.length;
  let endFull = full.length;
  while (
    endDisplayed > start &&
    endFull > start &&
    displayed[endDisplayed - 1] === full[endFull - 1]
  ) {
    endDisplayed -= 1;
    endFull -= 1;
  }
  const masked = displayed.slice(start, endDisplayed);
  const real = full.slice(start, endFull);
  if (!masked || !selection.includes(masked)) return null;
  return selection.split(masked).join(real);
}
