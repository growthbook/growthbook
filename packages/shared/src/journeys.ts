import type {
  JourneyStepGroup,
  ProductAnalyticsDimension,
} from "./validators/product-analytics";

export const JOURNEY_OTHER = "(other)";
export const JOURNEY_EXIT = "(exit)";
export const JOURNEY_ENTRY = "(entry)";
export const JOURNEY_NONE = "(none)";

export const JOURNEY_TERMINALS = new Set<string>([
  JOURNEY_EXIT,
  JOURNEY_ENTRY,
  JOURNEY_NONE,
]);

export const MAX_JOURNEY_RESULT_ROWS = 5000;
export const MAX_JOURNEY_FETCH_DEPTH = 4;
export const MAX_JOURNEY_RENDER_DEPTH = 3;
export const MIN_JOURNEY_OPTIONS_PER_STEP = 2;
export const MAX_JOURNEY_OPTIONS_PER_STEP = 50;
export const DEFAULT_JOURNEY_OPTIONS_PER_STEP = 5;
export const JOURNEY_OPTIONS_PER_STEP_INCREMENT = 3;
export const DEFAULT_JOURNEY_RENDER_DEPTH = 2;

export function journeyOptionsAt(
  optionsPerStep: number[] | number | undefined,
  levelIndex: number,
): number {
  if (typeof optionsPerStep === "number") return optionsPerStep;
  return optionsPerStep?.[levelIndex] ?? DEFAULT_JOURNEY_OPTIONS_PER_STEP;
}

export function withJourneyOptionsAt(
  optionsPerStep: number[] | undefined,
  levelIndex: number,
  value: number,
): number[] {
  const next = [...(optionsPerStep ?? [])];
  while (next.length <= levelIndex) {
    next.push(DEFAULT_JOURNEY_OPTIONS_PER_STEP);
  }
  next[levelIndex] = value;
  return next;
}

export function composeStepLabel(values: string[]): string {
  return values.join(" / ");
}

export function journeyTerminal(
  direction: "forward" | "backward",
): typeof JOURNEY_EXIT | typeof JOURNEY_ENTRY {
  return direction === "forward" ? JOURNEY_EXIT : JOURNEY_ENTRY;
}

export function isJourneyTerminal(value: string): boolean {
  return JOURNEY_TERMINALS.has(value);
}

const globRegExpCache = new Map<string, RegExp>();
const MAX_GLOB_CACHE_ENTRIES = 1000;

function globToRegExp(glob: string): RegExp {
  const cached = globRegExpCache.get(glob);
  if (cached) return cached;
  const source = glob
    .split(/([*?])/)
    .map((chunk) => {
      if (chunk === "*") return "[\\s\\S]*";
      if (chunk === "?") return "[\\s\\S]";
      return chunk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  const compiled = new RegExp(`^${source}$`);
  // Editing a pattern in the sidebar compiles one glob per keystroke, so cap
  // the cache rather than letting it grow with the session.
  if (globRegExpCache.size >= MAX_GLOB_CACHE_ENTRIES) globRegExpCache.clear();
  globRegExpCache.set(glob, compiled);
  return compiled;
}

export function matchesGlob(value: string, glob: string): boolean {
  return globToRegExp(glob).test(value);
}

export function stepGroupsForColumn(
  stepGroups: JourneyStepGroup[] | undefined,
  column: string,
): JourneyStepGroup[] {
  return (stepGroups ?? []).filter((g) => g.column === column);
}

/** First matching rule rewrites the value to its pattern (same as the SQL CASE). */
export function applyStepGroups(
  value: string,
  rules: JourneyStepGroup[],
): string {
  const match = rules.find((rule) => matchesGlob(value, rule.pattern));
  return match ? match.pattern : value;
}

/** `effective` is first-match (SQL CASE order); `matched` ignores order so a
 *  shadowed rule (`matched > 0`, `effective === 0`) can be flagged. */
export function stepGroupMatchCounts(
  sample: string[],
  rules: JourneyStepGroup[],
): { effective: number[]; matched: number[] } {
  const effective = rules.map(() => 0);
  const matched = rules.map(() => 0);
  for (const value of sample) {
    let first = -1;
    rules.forEach((rule, i) => {
      if (!rule.pattern || !matchesGlob(value, rule.pattern)) return;
      matched[i]++;
      if (first < 0) first = i;
    });
    if (first >= 0) effective[first]++;
  }
  return { effective, matched };
}

// Permissive: topValues is ~100 rows, so a real pattern may only show 2–3 times.
export const MIN_JOURNEY_GROUP_SIZE = 2;
export const MIN_JOURNEY_GROUP_DISTINCT_CHILDREN = 2;
export const MAX_JOURNEY_GROUP_SUGGESTIONS = 5;
export const MAX_JOURNEY_GROUP_PREFIX_SEGMENTS = 4;

export type JourneyStepGroupSuggestion = {
  pattern: string;
  matchedValues: string[];
  coverage: number;
};

type GroupCandidate = {
  pattern: string;
  // Non-empty prefix segments; lower is broader and wins ties.
  specificity: number;
  values: Set<string>;
  children: Set<string>;
};

function countSegments(parts: string[]): number {
  return parts.filter((p) => p !== "").length;
}

/** Propose `<prefix>/*` where a prefix fans out. Root-level `/pricing` stays
 *  ungrouped; `/pricing/cloud` and `/pricing/self-host` become `/pricing/*`. */
export function suggestJourneyStepGroups(
  values: string[],
): JourneyStepGroupSuggestion[] {
  const sample = Array.from(new Set(values.filter((v) => v !== "")));
  const candidates = new Map<string, GroupCandidate>();

  const record = (
    pattern: string,
    specificity: number,
    value: string,
    child: string,
  ) => {
    let candidate = candidates.get(pattern);
    if (!candidate) {
      candidate = {
        pattern,
        specificity,
        values: new Set(),
        children: new Set(),
      };
      candidates.set(pattern, candidate);
    }
    candidate.values.add(value);
    candidate.children.add(child);
  };

  for (const value of sample) {
    const queryIndex = value.indexOf("?");
    const path = queryIndex === -1 ? value : value.slice(0, queryIndex);
    const parts = path.split("/");

    for (let k = 1; k < parts.length; k++) {
      const prefixParts = parts.slice(0, k);
      const segments = countSegments(prefixParts);
      // Never propose a root-level `/*`, and stop before patterns get so deep
      // they stop collapsing anything useful.
      if (segments < 1) continue;
      if (segments > MAX_JOURNEY_GROUP_PREFIX_SEGMENTS) break;
      record(`${prefixParts.join("/")}/*`, segments, value, parts[k]);
    }

    // Same path, differing query strings — group as `<path>?*`. One segment
    // deeper than the equivalent path prefix so a path rule wins the tie.
    if (queryIndex !== -1) {
      record(
        `${path}?*`,
        countSegments(parts) + 1,
        value,
        value.slice(queryIndex),
      );
    }
  }

  const viable = Array.from(candidates.values())
    .filter(
      (c) =>
        c.children.size >= MIN_JOURNEY_GROUP_DISTINCT_CHILDREN &&
        c.values.size >= MIN_JOURNEY_GROUP_SIZE,
    )
    .sort(
      (a, b) => a.specificity - b.specificity || b.values.size - a.values.size,
    );

  // Broadest first, dropping any candidate whose values a wider accepted
  // pattern already covers, so `/a/*` is kept over `/a/b/*`.
  const accepted: GroupCandidate[] = [];
  for (const candidate of viable) {
    const values = Array.from(candidate.values);
    const covered = accepted.some((a) =>
      values.every((v) => matchesGlob(v, a.pattern)),
    );
    if (!covered) accepted.push(candidate);
  }

  return accepted
    .map((c) => ({
      pattern: c.pattern,
      matchedValues: Array.from(c.values).sort(),
      coverage: c.values.size,
    }))
    .sort(
      (a, b) => b.coverage - a.coverage || a.pattern.localeCompare(b.pattern),
    )
    .slice(0, MAX_JOURNEY_GROUP_SUGGESTIONS);
}

/** Fetch one extra frontier level beyond what is drawn, capped at 4. */
export function fetchDepthFromRenderDepth(renderDepth: number): number {
  return Math.min(MAX_JOURNEY_FETCH_DEPTH, Math.max(1, renderDepth) + 1);
}

/**
 * Upper bound on path-branch rows for one direction.
 *
 * a₁ = N₁ + 1 continuing buckets (top-N values + (other))
 * t₁ = 1 terminating bucket ((exit)/(entry))
 * aₖ = aₖ₋₁ · (Nₖ + 1)
 * tₖ = tₖ₋₁ + aₖ₋₁   // terminated prefixes contribute exactly one (none) tail
 * pathRows = (a_depth + t_depth) · (dimValues + 1)
 *
 * A number is treated as the same N at every frontier level. An array is
 * indexed from the anchor (`pathLength` + frontier offset).
 */
export function maxJourneyPathRows(
  optionsPerStep: number | number[],
  depth: number,
  dimValues: number,
  pathLength = 0,
): number {
  const d = Math.max(1, depth);
  const nAt = (frontierIndex: number) =>
    Math.max(0, journeyOptionsAt(optionsPerStep, pathLength + frontierIndex));
  let continuing = nAt(0) + 1;
  let terminating = 1;
  for (let k = 2; k <= d; k++) {
    terminating = terminating + continuing;
    continuing = continuing * (nAt(k - 1) + 1);
  }
  return (continuing + terminating) * (dimValues + 1);
}

export function maxJourneyProgressRows(
  pathLength: number,
  dimValues: number,
): number {
  if (pathLength <= 0) return 0;
  return (pathLength + 1) * 3 * (dimValues + 1);
}

export function maxJourneyResultRows({
  optionsPerStep,
  depth,
  pathLength,
  dimValues,
}: {
  optionsPerStep: number | number[];
  depth: number;
  pathLength: number;
  dimValues: number;
}): number {
  return (
    maxJourneyPathRows(optionsPerStep, depth, dimValues, pathLength) +
    maxJourneyProgressRows(pathLength, dimValues)
  );
}

export function journeyDimValueCount(
  dimension: ProductAnalyticsDimension | undefined,
): number {
  if (!dimension) return 0;
  switch (dimension.dimensionType) {
    case "dynamic":
      return dimension.maxValues;
    case "static":
      return dimension.values.length;
    case "slice":
      return dimension.slices.length;
    case "date":
      // Date buckets are top-N'd in SQL; budget against the same cap the
      // builder uses so a long range cannot silently unbounded the result.
      return 12;
    default:
      return 0;
  }
}

export function journeyConfigExceedsRowCap(params: {
  optionsPerStep: number | number[];
  depth: number;
  pathLength: number;
  dimValues: number;
}): boolean {
  return maxJourneyResultRows(params) > MAX_JOURNEY_RESULT_ROWS;
}

export function canIncreaseJourneyOptions(params: {
  optionsPerStep: number[];
  levelIndex: number;
  depth: number;
  pathLength: number;
  dimValues: number;
}): boolean {
  const current = journeyOptionsAt(params.optionsPerStep, params.levelIndex);
  const nextValue = current + JOURNEY_OPTIONS_PER_STEP_INCREMENT;
  if (nextValue > MAX_JOURNEY_OPTIONS_PER_STEP) return false;
  return !journeyConfigExceedsRowCap({
    optionsPerStep: withJourneyOptionsAt(
      params.optionsPerStep,
      params.levelIndex,
      nextValue,
    ),
    depth: params.depth,
    pathLength: params.pathLength,
    dimValues: params.dimValues,
  });
}
