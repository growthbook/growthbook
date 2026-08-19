import { isEqual } from "lodash";
import type { FactTableInterface } from "shared/types/fact-table";
import type {
  ExplorationConfig,
  JourneyDataset,
  JourneyPathStep,
  JourneyStepGroup,
  ProductAnalyticsDimension,
  ProductAnalyticsExploration,
  ProductAnalyticsJourneyRow,
  ProductAnalyticsResultRow,
} from "./validators/product-analytics";
import {
  DEFAULT_JOURNEY_OPTIONS_PER_STEP,
  MAX_JOURNEY_LOOKAHEAD_DEPTH,
  MAX_JOURNEY_OPTIONS_PER_STEP,
  MAX_JOURNEY_PATH_LENGTH,
} from "./validators/product-analytics";

export const JOURNEY_OTHER = "(other)";
export const JOURNEY_EXIT = "(exit)";
export const JOURNEY_ENTRY = "(entry)";
export const JOURNEY_NONE = "(none)";

export function journeyResultToStepValues(
  journey: ProductAnalyticsJourneyRow,
  path: JourneyPathStep[],
  lookaheadDepth: number,
): (string | null)[] {
  const n = path.length + lookaheadDepth;
  const prefix = path.map((step) => step.value);
  const steps: (string | null)[] = Array.from({ length: n }, () => null);
  switch (journey.kind) {
    case "path":
      for (let i = 0; i < prefix.length; i++) {
        steps[i] = prefix[i];
      }
      for (let i = 0; i < lookaheadDepth; i++) {
        steps[prefix.length + i] = journey.levels[i] ?? JOURNEY_NONE;
      }
      return steps;
    case "committed":
      for (let i = 0; i < journey.stepIndex && i < n; i++) {
        steps[i] = prefix[i] ?? null;
      }
      if (journey.stepIndex < n) {
        steps[journey.stepIndex] = journey.value;
      }
      return steps;
    default: {
      const exhaustive: never = journey;
      return exhaustive;
    }
  }
}

export function compareJourneyStepValues(
  a: (string | null)[],
  b: (string | null)[],
): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i];
    const bv = b[i];
    const aEmpty = (av ?? "") === "";
    const bEmpty = (bv ?? "") === "";
    if (aEmpty && bEmpty) continue;
    if (aEmpty) return -1;
    if (bEmpty) return 1;
    const cmp = (av ?? "").localeCompare(bv ?? "");
    if (cmp !== 0) return cmp;
  }
  return 0;
}

export const JOURNEY_TERMINALS = new Set<string>([
  JOURNEY_EXIT,
  JOURNEY_ENTRY,
  JOURNEY_NONE,
]);

export const MAX_JOURNEY_RESULT_ROWS = 5000;
export const JOURNEY_OPTIONS_PER_STEP_INCREMENT = 3;
export const JOURNEY_CACHE_CANDIDATE_LIMIT = 40;

type JourneyLookaheadNeed = "one" | "full";

export function journeyMinUnusedLookahead(
  requestedLookaheadDepth: number,
  need: JourneyLookaheadNeed,
): number {
  switch (need) {
    case "one":
      return 1;
    case "full":
      return requestedLookaheadDepth;
    default: {
      const _exhaustive: never = need;
      return _exhaustive;
    }
  }
}

export function journeyFamilyIdentity(dataset: JourneyDataset) {
  return {
    factTableId: dataset.factTableId,
    unit: dataset.unit,
    direction: dataset.direction,
    stepColumns: dataset.stepColumns,
    stepGroups: dataset.stepGroups ?? [],
    anchorStepValues: dataset.anchorStepValues,
    rowFilters: dataset.rowFilters,
  };
}

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
const MIN_JOURNEY_GROUP_SIZE = 2;
const MIN_JOURNEY_GROUP_DISTINCT_CHILDREN = 2;
const MAX_JOURNEY_GROUP_SUGGESTIONS = 5;
const MAX_JOURNEY_GROUP_PREFIX_SEGMENTS = 4;

type JourneyStepGroupSuggestion = {
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
  lookaheadDepth: number,
  dimValues: number,
  pathLength = 0,
): number {
  const d = Math.max(1, lookaheadDepth);
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

function maxJourneyCommittedRows(
  optionsPerStep: number | number[],
  pathLength: number,
  dimValues: number,
): number {
  if (pathLength <= 0) return 0;
  let n = 0;
  for (let k = 0; k < pathLength; k++) {
    n += (journeyOptionsAt(optionsPerStep, k) + 2) * (dimValues + 1);
  }
  return n;
}

export function maxJourneyResultRows({
  optionsPerStep,
  lookaheadDepth,
  pathLength,
  dimValues,
}: {
  optionsPerStep: number | number[];
  lookaheadDepth: number;
  pathLength: number;
  dimValues: number;
}): number {
  return (
    maxJourneyPathRows(optionsPerStep, lookaheadDepth, dimValues, pathLength) +
    maxJourneyCommittedRows(optionsPerStep, pathLength, dimValues)
  );
}

export function journeyPathIsPrefix(
  prefix: JourneyPathStep[],
  full: JourneyPathStep[],
): boolean {
  return (
    prefix.length <= full.length &&
    prefix.every((step, i) => step.value === full[i]?.value)
  );
}

export function journeyLevelMatchesStep(
  value: string | undefined,
  step: JourneyPathStep,
): boolean {
  if (value == null || value === JOURNEY_NONE) return false;
  return value === step.value;
}

function journeyFamilyEquals(
  cached: JourneyDataset,
  requested: JourneyDataset,
): boolean {
  return isEqual(
    journeyFamilyIdentity(cached),
    journeyFamilyIdentity(requested),
  );
}

function pathRowsContainStep(
  pathRows: { levels: string[] }[],
  extraPrefix: JourneyPathStep[],
  next: JourneyPathStep,
): boolean {
  return pathRows.some(
    (row) =>
      extraPrefix.every((step, i) =>
        journeyLevelMatchesStep(row.levels[i], step),
      ) && journeyLevelMatchesStep(row.levels[extraPrefix.length], next),
  );
}

function journeyOptionsLength(
  optionsPerStep: number[] | number | undefined,
): number {
  if (typeof optionsPerStep === "number") return 1;
  return optionsPerStep?.length ?? 0;
}

/** Cached SQL must already have at least as many named buckets at every step. */
function journeyOptionsCoverRequested(
  cached: JourneyDataset,
  requested: JourneyDataset,
): boolean {
  const last = Math.max(
    journeyOptionsLength(cached.optionsPerStep),
    journeyOptionsLength(requested.optionsPerStep),
    requested.path.length + 1,
  );
  for (let i = 0; i < last; i++) {
    if (
      journeyOptionsAt(cached.optionsPerStep, i) <
      journeyOptionsAt(requested.optionsPerStep, i)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The part of `journeyResultCanServe` that only needs the two configs.
 *
 * Callers holding many candidates (the Mongo cache probe) run this first so
 * they only have to load result rows — up to MAX_JOURNEY_RESULT_ROWS each — for
 * the handful that could still qualify.
 */
export function journeyCacheCandidateVerdict({
  cachedDataset,
  requestedDataset,
  minUnusedLookahead = 1,
}: {
  cachedDataset: JourneyDataset;
  requestedDataset: JourneyDataset;
  minUnusedLookahead?: number;
}): "no" | "yes" | "needs-rows" {
  if (!journeyFamilyEquals(cachedDataset, requestedDataset)) return "no";
  if (!journeyOptionsCoverRequested(cachedDataset, requestedDataset)) {
    return "no";
  }

  const cachedPath = cachedDataset.path;
  const requestedPath = requestedDataset.path;

  if (journeyPathIsPrefix(requestedPath, cachedPath)) {
    if (requestedPath.length === cachedPath.length) {
      return cachedDataset.lookaheadDepth >= minUnusedLookahead ? "yes" : "no";
    }
    // Pop can reuse one stored frontier; that is not a full lookahead.
    if (minUnusedLookahead > 1) return "no";
    return "needs-rows";
  }

  if (!journeyPathIsPrefix(cachedPath, requestedPath)) return "no";
  const extra = requestedPath.slice(cachedPath.length);
  if (cachedDataset.lookaheadDepth - extra.length < minUnusedLookahead) {
    return "no";
  }
  return "needs-rows";
}

/** Cached result can draw the requested path plus `minUnusedLookahead` leftover levels. */
export function journeyResultCanServe({
  cachedDataset,
  cachedRows,
  requestedDataset,
  minUnusedLookahead = 1,
}: {
  cachedDataset: JourneyDataset;
  cachedRows: ProductAnalyticsResultRow[];
  requestedDataset: JourneyDataset;
  minUnusedLookahead?: number;
}): boolean {
  const verdict = journeyCacheCandidateVerdict({
    cachedDataset,
    requestedDataset,
    minUnusedLookahead,
  });
  if (verdict !== "needs-rows") return verdict === "yes";

  const cachedPath = cachedDataset.path;
  const requestedPath = requestedDataset.path;

  if (journeyPathIsPrefix(requestedPath, cachedPath)) {
    return cachedRows.some(
      (row) =>
        row.journey?.kind === "committed" &&
        row.journey.stepIndex === requestedPath.length,
    );
  }

  const pathRows = cachedRows
    .map((row) => row.journey)
    .filter(
      (j): j is Extract<NonNullable<typeof j>, { kind: "path" }> =>
        j != null && j.kind === "path",
    );
  const extraPrefix: JourneyPathStep[] = [];
  for (const step of requestedPath.slice(cachedPath.length)) {
    if (!pathRowsContainStep(pathRows, extraPrefix, step)) return false;
    extraPrefix.push(step);
  }
  return true;
}

/**
 * SQL still fetches `dataset.lookaheadDepth` levels. Responses expose a single
 * frontier so the client can render the payload as-is.
 */
export const JOURNEY_DISPLAY_LOOKAHEAD = 1;

function journeyRowDimKey(dimensions: Array<string | null>): string {
  return dimensions.map((d) => d ?? "").join("\0");
}

function cloneJourneyRow(
  row: ProductAnalyticsResultRow,
  journey: NonNullable<ProductAnalyticsResultRow["journey"]>,
): ProductAnalyticsResultRow {
  return {
    dimensions: [...row.dimensions],
    journey:
      journey.kind === "path"
        ? { ...journey, levels: [...journey.levels] }
        : { ...journey },
  };
}

function aggregateJourneyRows(
  rows: ProductAnalyticsResultRow[],
): ProductAnalyticsResultRow[] {
  const map = new Map<string, ProductAnalyticsResultRow>();
  for (const row of rows) {
    const journey = row.journey;
    if (!journey) continue;
    const dimKey = journeyRowDimKey(row.dimensions);
    const key =
      journey.kind === "path"
        ? `p:${journey.levels.join("\0")}:${dimKey}`
        : `c:${journey.stepIndex}:${journey.value}:${dimKey}`;
    const existing = map.get(key);
    if (existing?.journey) {
      existing.journey = {
        ...existing.journey,
        count: existing.journey.count + journey.count,
      };
      continue;
    }
    map.set(key, cloneJourneyRow(row, journey));
  }
  return Array.from(map.values());
}

function pathRowMatchesPrefix(
  levels: string[],
  prefix: JourneyPathStep[],
): boolean {
  return prefix.every((step, i) => journeyLevelMatchesStep(levels[i], step));
}

/**
 * Collapse a cached lookahead result to the one-frontier view for `requestedDataset.path`.
 *
 * Callers must already know the cache can serve the request (`journeyResultCanServe`).
 */
export function projectJourneyRows({
  cachedDataset,
  cachedRows,
  requestedDataset,
}: {
  cachedDataset: JourneyDataset;
  cachedRows: ProductAnalyticsResultRow[];
  requestedDataset: JourneyDataset;
}): ProductAnalyticsResultRow[] {
  const cachedPath = cachedDataset.path;
  const requestedPath = requestedDataset.path;
  const projected: ProductAnalyticsResultRow[] = [];

  if (
    requestedPath.length < cachedPath.length &&
    journeyPathIsPrefix(requestedPath, cachedPath)
  ) {
    for (const row of cachedRows) {
      const journey = row.journey;
      if (journey?.kind !== "committed") continue;
      if (journey.stepIndex < requestedPath.length) {
        projected.push(cloneJourneyRow(row, journey));
      } else if (journey.stepIndex === requestedPath.length) {
        if (journey.value === JOURNEY_NONE) continue;
        projected.push(
          cloneJourneyRow(row, {
            kind: "path",
            direction: journey.direction,
            levels: [journey.value],
            count: journey.count,
          }),
        );
      }
    }
    return aggregateJourneyRows(projected);
  }

  const extra = requestedPath.slice(cachedPath.length);
  for (const row of cachedRows) {
    const journey = row.journey;
    if (
      journey?.kind === "committed" &&
      journey.stepIndex < cachedPath.length
    ) {
      projected.push(cloneJourneyRow(row, journey));
    }
  }

  const pathRows = cachedRows.filter(
    (
      row,
    ): row is ProductAnalyticsResultRow & {
      journey: Extract<
        NonNullable<ProductAnalyticsResultRow["journey"]>,
        { kind: "path" }
      >;
    } => row.journey?.kind === "path",
  );

  for (let i = 0; i < extra.length; i++) {
    const prefix = extra.slice(0, i);
    for (const row of pathRows) {
      if (!pathRowMatchesPrefix(row.journey.levels, prefix)) continue;
      const value = row.journey.levels[i];
      if (value == null || value === JOURNEY_NONE) continue;
      projected.push({
        dimensions: [...row.dimensions],
        journey: {
          kind: "committed",
          direction: row.journey.direction,
          stepIndex: cachedPath.length + i,
          value,
          count: row.journey.count,
        },
      });
    }
  }

  for (const row of pathRows) {
    if (!pathRowMatchesPrefix(row.journey.levels, extra)) continue;
    const levels = row.journey.levels
      .slice(extra.length, extra.length + JOURNEY_DISPLAY_LOOKAHEAD)
      .filter((value) => value !== JOURNEY_NONE);
    if (!levels.length) continue;
    projected.push({
      dimensions: [...row.dimensions],
      journey: {
        kind: "path",
        direction: row.journey.direction,
        levels,
        count: row.journey.count,
      },
    });
  }

  return aggregateJourneyRows(projected);
}

export function journeyDisplayLookaheadDepth(
  rows: ProductAnalyticsResultRow[],
): number {
  let depth = 0;
  for (const row of rows) {
    if (row.journey?.kind === "path") {
      depth = Math.max(depth, row.journey.levels.length);
    }
  }
  return depth;
}

/** Overlay the requested path and collapse cached lookahead to the display frontier. */
export function toClientJourneyExploration(
  exploration: ProductAnalyticsExploration,
  requested: ExplorationConfig,
): ProductAnalyticsExploration {
  if (exploration.config.type !== "journey" || requested.type !== "journey") {
    return {
      ...exploration,
      config: {
        ...exploration.config,
        chartType: requested.chartType,
        dateRange: requested.dateRange,
      },
    };
  }
  const cachedDataset = exploration.config.dataset;
  const requestedDataset = requested.dataset;
  const rows = projectJourneyRows({
    cachedDataset,
    cachedRows: exploration.result?.rows ?? [],
    requestedDataset,
  });
  return {
    ...exploration,
    config: {
      ...exploration.config,
      chartType: requested.chartType,
      dateRange: requested.dateRange,
      dataset: {
        ...cachedDataset,
        path: requestedDataset.path,
        optionsPerStep: requestedDataset.optionsPerStep,
      },
    },
    result: { ...(exploration.result ?? { rows: [] }), rows },
  };
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

function journeyConfigExceedsRowCap(params: {
  optionsPerStep: number | number[];
  lookaheadDepth: number;
  pathLength: number;
  dimValues: number;
}): boolean {
  return maxJourneyResultRows(params) > MAX_JOURNEY_RESULT_ROWS;
}

export function canIncreaseJourneyOptions(params: {
  optionsPerStep: number[];
  levelIndex: number;
  lookaheadDepth: number;
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
    lookaheadDepth: params.lookaheadDepth,
    pathLength: params.pathLength,
    dimValues: params.dimValues,
  });
}

/**
 * Every semantic rule a journey dataset must satisfy before it can be turned
 * into SQL, in one place. Returns user-facing messages rather than throwing so
 * each caller can surface them its own way: the API throws BadRequestError, the
 * SQL builder throws, and the explorer uses `isEmpty` to enable/disable Run.
 *
 * Zod stays purely structural — a half-configured draft in the sidebar must
 * still parse and round-trip through the URL.
 */
export function validateJourneyDataset(
  dataset: JourneyDataset,
  dimension?: ProductAnalyticsDimension,
): string[] {
  const errors: string[] = [];

  if (!dataset.factTableId) errors.push("Fact Table is required");
  if (!dataset.unit) errors.push("Journey unit is required");
  if (!dataset.stepColumns.length) {
    errors.push("Journey step columns are required");
  }
  if (
    !dataset.anchorStepValues ||
    dataset.anchorStepValues.length !== dataset.stepColumns.length ||
    dataset.anchorStepValues.some((v) => !v)
  ) {
    errors.push("Journey starting step is required");
  }
  for (const group of dataset.stepGroups ?? []) {
    if (!group.pattern) {
      errors.push("Journey grouping rule pattern is required");
    } else if (!dataset.stepColumns.includes(group.column)) {
      errors.push(
        `Journey grouping rule references column "${group.column}", which is not a step column`,
      );
    }
  }
  // Zod already enforces the range on anything parsed, but the SQL builder
  // silently emits a broken query for a missing depth, so check it here too:
  // this is the one rule whose violation isn't self-evident downstream.
  if (
    !Number.isInteger(dataset.lookaheadDepth) ||
    dataset.lookaheadDepth < 1 ||
    dataset.lookaheadDepth > MAX_JOURNEY_LOOKAHEAD_DEPTH
  ) {
    errors.push(
      `Journey lookahead depth must be between 1 and ${MAX_JOURNEY_LOOKAHEAD_DEPTH}`,
    );
  }
  if (dataset.path.length > MAX_JOURNEY_PATH_LENGTH) {
    errors.push(
      `Journey paths cannot contain more than ${MAX_JOURNEY_PATH_LENGTH} steps.`,
    );
  }
  if (
    journeyConfigExceedsRowCap({
      optionsPerStep: dataset.optionsPerStep,
      lookaheadDepth: dataset.lookaheadDepth,
      pathLength: dataset.path.length,
      dimValues: journeyDimValueCount(dimension),
    })
  ) {
    errors.push(
      `Journey result would exceed ${MAX_JOURNEY_RESULT_ROWS} rows. Lower options per step, steps to show, or dimension values.`,
    );
  }

  return errors;
}

export function validateJourneyStepColumns(
  dataset: JourneyDataset,
  factTable: Pick<FactTableInterface, "columns">,
): string[] {
  const availableColumns = new Set(
    factTable.columns
      .filter((column) => !column.deleted)
      .map((column) => column.column),
  );
  return Array.from(new Set(dataset.stepColumns))
    .filter((column) => !availableColumns.has(column))
    .map(
      (column) =>
        `Journey step column "${column}" does not exist on the Fact Table.`,
    );
}

/** True when `dataset` is complete enough to run. */
export function isJourneyDatasetRunnable(
  dataset: JourneyDataset,
  dimension?: ProductAnalyticsDimension,
): boolean {
  return validateJourneyDataset(dataset, dimension).length === 0;
}
