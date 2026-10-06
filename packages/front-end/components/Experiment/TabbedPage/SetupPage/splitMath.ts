// The Edit Split % modal's arithmetic (SplitEditModal.tsx; set in review).
// Values are percentages with at most one decimal place, and every result
// adds up to exactly 100.

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n));
}

// Give any rounding leftover to the largest of `among` (the lowest index on
// a tie), so the values add to exactly 100. Deterministic; nothing dropped.
export function settleTo100(values: number[], among: number[]): number[] {
  const out = [...values];
  const leftover = round1(100 - out.reduce((a, b) => a + b, 0));
  if (leftover === 0 || !among.length) return out;
  const target = among.reduce(
    (best, i) => (out[i] > out[best] ? i : best),
    among[0],
  );
  out[target] = round1(out[target] + leftover);
  return out;
}

// Normalise after field `index` changed to `raw`.
export function normalizeSplit(values: number[], index: number, raw: number) {
  const v = round1(clamp(Number.isFinite(raw) ? raw : 0));
  const others = values.map((_, i) => i).filter((i) => i !== index);
  const remaining = round1(100 - v);
  const otherTotal = others.reduce((a, i) => a + values[i], 0);
  const next = [...values];
  next[index] = v;
  others.forEach((i) => {
    next[i] = round1(
      otherTotal > 0
        ? (remaining * values[i]) / otherTotal
        : remaining / others.length,
    );
  });
  return settleTo100(next, others);
}

export function evenSplit(n: number): number[] {
  const each = round1(100 / n);
  const all = Array.from({ length: n }, (_, i) => i);
  return settleTo100(
    all.map(() => each),
    all,
  );
}
