// Merge the model's global-CSS output onto the saved stylesheet. `replace`
// is a full rewrite (to modify or remove an existing rule); `append` is new
// rules only. Both may be present — the rewrite is then the base. Returns
// undefined when nothing changes. Empty strings count as "no change":
// clearing CSS through the AI is deliberately unsupported (that's the manual
// editor's job), so a blank can never wipe the variation.
export function mergeGlobalCss({
  existing,
  replace,
  append,
}: {
  existing: string | undefined;
  replace: string | null | undefined;
  append: string | null | undefined;
}): string | undefined {
  const current = existing ?? "";
  const base = replace && replace.trim() ? replace : current;
  const extra = append?.trim() ?? "";
  // Stronger models sometimes re-emit a rule they already added.
  const merged =
    extra && !base.includes(extra)
      ? [base.trim(), extra].filter(Boolean).join("\n\n")
      : base;
  return merged && merged !== current ? merged : undefined;
}

export interface SkippedItem {
  request: string;
  reason: string;
}

// Surface the parts the model didn't do below its explanation, one bullet
// each, so a partial result reads as one rather than a silent omission.
export function appendSkipped(
  explanation: string,
  skipped: SkippedItem[] | null | undefined,
): string {
  const lines = (skipped ?? [])
    .map((s) => ({ request: s.request.trim(), reason: s.reason.trim() }))
    .filter((s) => s.request)
    .map((s) => `• ${s.request}${s.reason ? ` — ${s.reason}` : ""}`);
  if (lines.length === 0) return explanation;
  return [explanation.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
}
