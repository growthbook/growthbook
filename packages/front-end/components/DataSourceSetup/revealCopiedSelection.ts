/**
 * The displayed SQL and the copyable SQL differ wherever a credential is
 * masked. The same mask can appear more than once (e.g. a password statement
 * repeated in a CREATE and an ALTER), so a highlight covering just one of
 * those spans should still reveal the real value for that span.
 */
export function revealCopiedSelection(
  displayed: string,
  full: string,
  selection: string,
): string | null {
  let result = selection;
  let replacedAny = false;
  for (const { masked, real } of diffSpans(displayed, full)) {
    if (masked && result.includes(masked)) {
      result = result.split(masked).join(real);
      replacedAny = true;
    }
  }
  return replacedAny ? result : null;
}

/** The minimal (masked, real) substring pairs where `displayed` and `full` disagree, via an LCS diff. */
function diffSpans(
  displayed: string,
  full: string,
): { masked: string; real: string }[] {
  const n = displayed.length;
  const m = full.length;
  // lcs[i][j] holds the LCS length of displayed[i:] and full[j:].
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        displayed[i] === full[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const spans: { masked: string; real: string }[] = [];
  let i = 0;
  let j = 0;
  let maskedStart: number | null = null;
  let realStart: number | null = null;
  while (i < n || j < m) {
    if (i < n && j < m && displayed[i] === full[j]) {
      if (maskedStart !== null) {
        spans.push({
          masked: displayed.slice(maskedStart, i),
          real: full.slice(realStart as number, j),
        });
        maskedStart = null;
      }
      i += 1;
      j += 1;
    } else {
      if (maskedStart === null) {
        maskedStart = i;
        realStart = j;
      }
      // Walk whichever side keeps more of the eventual common subsequence
      // ahead of it, same as the usual LCS-diff backtrace.
      if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) i += 1;
      else j += 1;
    }
  }
  if (maskedStart !== null) {
    spans.push({
      masked: displayed.slice(maskedStart, i),
      real: full.slice(realStart as number, j),
    });
  }
  return spans;
}
