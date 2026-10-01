import { stemRuleId } from "shared/util";
import type { FeatureRule, FeatureUsageDimension } from "shared/types/feature";
import type { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { CHART_COLORS } from "@/enterprise/components/ProductAnalytics/chart-theme";

/**
 * Pure helpers behind the Diagnostics chart's colours and its breakdown panel,
 * kept out of the component so the zero-versus-unknown rule can be tested.
 */

/**
 * Validated pair for the boolean Value grouping: violet plus a neutral, at CVD
 * ΔE 18.3 with both clearing 3:1. Deliberately NOT CHART_COLORS[0..1] — two
 * saturated hues read as two categories, when this is one thing that is either
 * on or off.
 */
export const BOOLEAN_SERIES_COLORS: Record<string, string> = {
  true: "#6e56cf",
  false: "#8b8da3",
};

/** The API's fold bucket for groups past its 25-group cap. */
export const OTHER_GROUP = "(other)";
/** SDK telemetry's ruleId for an evaluation served by the default value. */
export const DEFAULT_RULE_KEY = "$default";
/**
 * Neutral for the default value: it is not a rule, so it takes no categorical
 * colour a rule should have had. Same grey as the boolean `false`.
 */
export const DEFAULT_RULE_COLOR = BOOLEAN_SERIES_COLORS.false;
/** The palette's own neutral, held back from rules for the fold bucket. */
export const OTHER_COLOR = "#6b7280";
const CATEGORICAL = CHART_COLORS.filter((c) => c !== OTHER_COLOR);

/**
 * Colour per group, stable across traffic shifts.
 *
 * Rule grouping is keyed to the RULE: its position in the flag's full rule
 * list, not its volume rank and not its position among the groups that
 * happened to have traffic. Either of those recolours a rule when some other
 * rule gains or loses traffic, and then the panel's swatch, the chart band and
 * any other surface stop agreeing on which colour a rule is. Keyed by stem, so
 * an `__env`-suffixed row and its rule land on the same colour.
 *
 * Every other grouping keeps colour-by-sorted-name. Value keeps its boolean
 * pair for true/false; any other value now takes the palette too, where it used
 * to fall through to ECharts' own palette and could not be matched by a swatch.
 */
export function buildSeriesColors(
  dimension: FeatureUsageDimension,
  rows: { group: string }[],
  rules: FeatureRule[],
): Record<string, string> {
  const groups = [...new Set(rows.map((r) => r.group))].sort((a, b) =>
    a.localeCompare(b),
  );

  if (dimension === "ruleId") {
    const byStem = new Map<string, string>();
    rules.forEach((rule, i) => {
      if (!rule.id) return;
      const stem = stemRuleId(rule.id);
      if (!byStem.has(stem)) {
        byStem.set(stem, CATEGORICAL[i % CATEGORICAL.length]);
      }
    });
    byStem.set(DEFAULT_RULE_KEY, DEFAULT_RULE_COLOR);
    byStem.set(OTHER_GROUP, OTHER_COLOR);
    // Ids on no current rule continue the palette after the rules, in sorted
    // order, so they never take a slot a live rule owns.
    let next = rules.length;
    groups.forEach((group) => {
      const stem = stemRuleId(group);
      if (!byStem.has(stem)) {
        byStem.set(stem, CATEGORICAL[next++ % CATEGORICAL.length]);
      }
    });
    const colors: Record<string, string> = {};
    byStem.forEach((color, stem) => (colors[stem] = color));
    groups.forEach((group) => {
      colors[group] = byStem.get(stemRuleId(group)) ?? OTHER_COLOR;
    });
    return colors;
  }

  if (dimension === "value") {
    const colors: Record<string, string> = { ...BOOLEAN_SERIES_COLORS };
    groups
      .filter((g) => !(g in BOOLEAN_SERIES_COLORS))
      .forEach((group, i) => {
        colors[group] =
          group === OTHER_GROUP
            ? OTHER_COLOR
            : CATEGORICAL[i % CATEGORICAL.length];
      });
    return colors;
  }

  return Object.fromEntries(
    groups.map((group, i) => [group, CHART_COLORS[i % CHART_COLORS.length]]),
  );
}

/**
 * How a rule is named everywhere it is referred to rather than edited: its
 * description when it has one, otherwise the type. Experiment refs name the
 * experiment, the way the rule card's heading does. Never the raw id — an
 * `fr_` id identifies nothing to a reader.
 */
export function ruleReference(
  rule: FeatureRule,
  experimentsMap: Map<string, ExperimentInterfaceStringDates>,
): string {
  if (rule.type === "experiment-ref") {
    const experiment = experimentsMap.get(rule.experimentId);
    if (experiment) {
      const kind =
        experiment.type === "multi-armed-bandit" ? "Bandit" : "Experiment";
      return `${kind}: ${experiment.name}`;
    }
  }
  if (rule.description?.trim()) return rule.description.trim();
  if (rule.type === "safe-rollout") return "Safe Rollout";
  if (rule.type === "experiment-ref") return "Experiment";
  const type = rule.type[0].toUpperCase() + rule.type.slice(1);
  return rule.type === "rollout" ? type : `${type} Rule`;
}

export interface BreakdownRow {
  /** Selection key: the chart's series name, or the rule stem when it has none. */
  key: string;
  /** The rule's number, as on its card. Absent for anything that is not a rule. */
  index?: number;
  label: string;
  color: string;
  /**
   * Evaluations in the window. `null` is UNKNOWN, not zero: the dimension was
   * folded or truncated, so a group missing from the rows may still have had
   * traffic — it is inside "(other)" or below the scan's row limit.
   */
  count: number | null;
}

/**
 * One row per group the reader could ask about, not only the ones with
 * traffic. A legend can only list series present in the data, so a rule that
 * never fired is invisible in one — and "the rule I expected isn't there" is
 * one of the more useful answers this tab gives.
 *
 * Zero is only claimed when the dimension is COMPLETE: no "(other)" fold and
 * nothing withheld by the scan's row limit. Otherwise a group missing from the
 * rows may have traffic that was folded or cut, and it gets an unknown count
 * rather than a zero — on a screen people use to decide what to delete, a false
 * zero is the destructive answer.
 */
export function buildBreakdownRows({
  dimension,
  rows,
  colors,
  complete,
  rules,
  ruleNumberOffset,
  scopeEnvironments,
  environmentIds,
  experimentsMap,
  valueType,
}: {
  dimension: FeatureUsageDimension;
  rows: { group: string; evaluations: number }[];
  colors: Record<string, string>;
  complete: boolean;
  rules: FeatureRule[];
  ruleNumberOffset: number;
  scopeEnvironments: string[];
  environmentIds: string[];
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  valueType?: string;
}): BreakdownRow[] {
  const counts = new Map<string, number>();
  rows.forEach((r) =>
    counts.set(r.group, (counts.get(r.group) ?? 0) + r.evaluations),
  );
  const absent = complete ? 0 : null;
  const byVolume = (a: BreakdownRow, b: BreakdownRow) =>
    (b.count ?? -1) - (a.count ?? -1);
  const otherRow = (): BreakdownRow[] =>
    counts.has(OTHER_GROUP)
      ? [
          {
            key: OTHER_GROUP,
            label: "Other (outside top 25)",
            color: colors[OTHER_GROUP] ?? OTHER_COLOR,
            count: counts.get(OTHER_GROUP) ?? 0,
          },
        ]
      : [];

  if (dimension === "ruleId") {
    // Joined by stem: v1-migrated rules carry an `__env` suffix in their id
    // that telemetry strips, so a raw compare would never match them.
    const byStem = new Map<string, { group: string; count: number }>();
    counts.forEach((count, group) => {
      if (group === OTHER_GROUP) return;
      const stem = stemRuleId(group);
      const prev = byStem.get(stem);
      byStem.set(stem, {
        group: prev?.group ?? group,
        count: (prev?.count ?? 0) + count,
      });
    });

    const inScope = (rule: FeatureRule) =>
      !scopeEnvironments.length ||
      rule.allEnvironments ||
      (rule.environments ?? []).some((e) => scopeEnvironments.includes(e));

    const out: BreakdownRow[] = [];
    const listed = new Set<string>();
    rules.forEach((rule, i) => {
      if (!rule.id) return;
      const stem = stemRuleId(rule.id);
      if (listed.has(stem)) return;
      const hit = byStem.get(stem);
      // Out-of-scope rules still appear when they have traffic: the chart is
      // drawing their band, so the panel has to name it.
      if (!hit && !inScope(rule)) return;
      listed.add(stem);
      out.push({
        key: hit?.group ?? stem,
        index: i + ruleNumberOffset,
        label: ruleReference(rule, experimentsMap),
        color: colors[stem],
        count: hit ? hit.count : absent,
      });
    });

    const defaultHit = byStem.get(DEFAULT_RULE_KEY);
    listed.add(DEFAULT_RULE_KEY);
    out.push({
      key: defaultHit?.group ?? DEFAULT_RULE_KEY,
      label: "Default Value",
      color: DEFAULT_RULE_COLOR,
      count: defaultHit ? defaultHit.count : absent,
    });

    // Traffic under ids no current rule has: a rule since removed, or rows
    // with no rule id at all. Listed so the panel still sums to the chart.
    const unmatched: BreakdownRow[] = [];
    byStem.forEach(({ group, count }, stem) => {
      if (listed.has(stem)) return;
      unmatched.push({
        key: group,
        label: stem === "" ? "No rule ID" : "Removed rule",
        color: colors[group] ?? OTHER_COLOR,
        count,
      });
    });
    return [...out, ...unmatched.sort(byVolume), ...otherRow()];
  }

  // Groups that should be listed even with no traffic: both booleans, and
  // every environment relevant to the flag.
  const expected =
    dimension === "value" && valueType === "boolean"
      ? ["true", "false"]
      : dimension === "environment"
        ? environmentIds
        : [];
  const keys = new Set<string>([...expected, ...counts.keys()]);
  keys.delete(OTHER_GROUP);
  const out: BreakdownRow[] = Array.from(keys).map((group) => ({
    key: group,
    label: group,
    color: colors[group] ?? OTHER_COLOR,
    count: counts.has(group) ? (counts.get(group) ?? 0) : absent,
  }));
  // Booleans keep true-then-false; everything else leads with volume.
  if (!(dimension === "value" && valueType === "boolean")) out.sort(byVolume);
  return [...out, ...otherRow()];
}

/** What a stream row's ruleId refers to. */
export type RuleCellReference =
  | { kind: "rule"; label: string; color: string }
  /** "$default": the default value was served. */
  | { kind: "default" }
  /** "": served without a rule (an override, a prerequisite). */
  | { kind: "none" }
  /** No rule in the flag's current config has this stem. */
  | { kind: "deleted" };

/**
 * Resolves a stream row's ruleId to the same name and colour the breakdown
 * panel and chart give it, by calling their functions rather than restating
 * them: the label is ruleReference, the colour is buildSeriesColors' Rule
 * grouping (keyed to the rule's position in the flag's rule list, not to its
 * traffic, so it matches the chart band whatever the volumes).
 *
 * Matched by stem: telemetry carries stemRuleId, so a v1-migrated rule stored
 * as "fr_abc__production" arrives as "fr_abc". A raw compare would call every
 * such rule deleted.
 */
export function buildRuleCellResolver(
  rules: FeatureRule[],
  experimentsMap: Map<string, ExperimentInterfaceStringDates>,
): (ruleId: string) => RuleCellReference {
  const colors = buildSeriesColors("ruleId", [], rules);
  const byStem = new Map<string, FeatureRule>();
  rules.forEach((rule) => {
    if (!rule.id) return;
    const stem = stemRuleId(rule.id);
    if (!byStem.has(stem)) byStem.set(stem, rule);
  });
  return (ruleId) => {
    if (ruleId === DEFAULT_RULE_KEY) return { kind: "default" };
    if (ruleId === "") return { kind: "none" };
    const stem = stemRuleId(ruleId);
    const rule = byStem.get(stem);
    if (!rule) return { kind: "deleted" };
    return {
      kind: "rule",
      label: ruleReference(rule, experimentsMap),
      color: colors[stem],
    };
  };
}

/**
 * "Served without a rule": a lighter neutral than DEFAULT_RULE_COLOR and
 * OTHER_COLOR, so the two non-rule segments are told apart. Each also has its
 * own legend row, so colour never carries the distinction alone.
 */
export const NO_RULE_COLOR = "#c8cad4";

export interface RuleTrafficSegment {
  key: string;
  kind: "rule" | "removed" | "default" | "none";
  /** The rule's number, as on its card. Rules only. */
  index?: number;
  label: string;
  color: string;
  count: number;
}

/**
 * The Traffic card's segments, in display order: the flag's rules in rule
 * order (every rule, even at zero), then traffic under rule ids no longer on
 * the flag (only when there is some), then the default value, then
 * evaluations served without a rule.
 *
 * Order is deliberate: an override short-circuits before any rule runs, so in
 * flow order "served without a rule" would come first. It goes last so the
 * rules — the if / else-if chain — read unbroken, with the non-rule groups
 * together at the end.
 *
 * The denominator is `includedEvaluations` from the same response: every
 * per-rule row the warehouse returned. byRuleId is that set minus the
 * empty-ruleId rows, so the difference IS "served without a rule", exactly.
 * Anything past the denominator (`total` above it) was counted but cut by the
 * scan's row cap, and has no rule to sit under: it is reported, not drawn.
 * Without the disclosure (dummy mode) the denominator is byRuleId's own sum.
 */
export function buildRuleTrafficSegments({
  rules,
  experimentsMap,
  byRuleId,
  total,
  includedEvaluations,
  ruleNumberOffset,
}: {
  rules: FeatureRule[];
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  byRuleId: { v: Record<string, number> }[];
  total: number;
  includedEvaluations?: number;
  ruleNumberOffset: number;
}): {
  segments: RuleTrafficSegment[];
  denominator: number;
  notBrokenDown: number;
} {
  const byStem = new Map<string, number>();
  let ruleRowsSum = 0;
  byRuleId.forEach((point) =>
    Object.entries(point.v).forEach(([key, n]) => {
      const count = n || 0;
      ruleRowsSum += count;
      const stem = stemRuleId(key);
      byStem.set(stem, (byStem.get(stem) ?? 0) + count);
    }),
  );

  const colors = buildSeriesColors("ruleId", [], rules);
  const segments: RuleTrafficSegment[] = [];
  const listed = new Set<string>([DEFAULT_RULE_KEY]);
  rules.forEach((rule, i) => {
    if (!rule.id) return;
    const stem = stemRuleId(rule.id);
    if (listed.has(stem)) return;
    listed.add(stem);
    segments.push({
      key: stem,
      kind: "rule",
      index: i + ruleNumberOffset,
      label: ruleReference(rule, experimentsMap),
      color: colors[stem],
      count: byStem.get(stem) ?? 0,
    });
  });

  let removed = 0;
  byStem.forEach((count, stem) => {
    if (!listed.has(stem)) removed += count;
  });
  if (removed > 0) {
    segments.push({
      key: "(removed)",
      kind: "removed",
      label: "Rules no longer on this flag",
      color: OTHER_COLOR,
      count: removed,
    });
  }

  segments.push({
    key: DEFAULT_RULE_KEY,
    kind: "default",
    label: "Default value",
    color: DEFAULT_RULE_COLOR,
    count: byStem.get(DEFAULT_RULE_KEY) ?? 0,
  });

  const denominator = Math.max(includedEvaluations ?? 0, ruleRowsSum);
  segments.push({
    key: "(none)",
    kind: "none",
    label: "Served without a rule",
    color: NO_RULE_COLOR,
    count: denominator - ruleRowsSum,
  });

  return {
    segments,
    denominator,
    notBrokenDown:
      includedEvaluations === undefined ? 0 : Math.max(0, total - denominator),
  };
}
