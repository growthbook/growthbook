import { FeatureRule, FeatureValueType } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { NamespaceValue, SafeRolloutInterface } from "shared/validators";
import {
  getLatestPhaseVariations,
  hasTargetingConfigured,
} from "shared/experiments";
import {
  getNamespaceRanges,
  isMultiRangeInPayload,
  ruleProjectScope,
} from "shared/util";

// A prerequisite's outcome in one environment.
export type PrerequisiteResult = "met" | "unmet" | "varies" | "cycle";

// Which of the flag's SDK connections a rule's own project scope reaches, as
// the payload drops it per connection: every one, only some, or none. Null
// delivery projects means the flag goes to every project.
export function ruleProjectReach(
  rule: FeatureRule,
  deliveryProjects: string[] | null,
): "all" | "some" | "none" {
  const scope = ruleProjectScope(rule);
  if (scope === null) return "all";
  const reached =
    deliveryProjects === null
      ? scope
      : deliveryProjects.filter((p) => scope.includes(p));
  if (!reached.length) return "none";
  return deliveryProjects !== null && reached.length === deliveryProjects.length
    ? "all"
    : "some";
}

type Share = { value: string; share: number };

// One thing traffic passes through before the default value: the holdout, or a
// rule. `traffic` is how it splits whoever reaches it — the share it takes
// (`participation`) and the values that share is served, null when they move
// as a bandit's do — or null when none of that is known ahead of time.
// Targeted, the share it takes depends on who the user is.
export type TrafficStep = {
  kind: "holdout" | "rule";
  // What kind it is: "Experiment", "Holdout".
  label: string;
  // An experiment's or bandit's arms.
  variations: number | null;
  targeted: boolean;
  traffic: { participation: number; shares: Share[] | null } | null;
};

// What an environment serves: one value to everyone (null when it serves
// nothing), one value to a share of users, several values in known shares, or
// something that depends on who the user is.
export type EnvironmentValue =
  | { kind: "value"; value: string | null }
  // Null when the share can't be known: steps that each take part of the
  // traffic overlap however their hashes happen to line up.
  | { kind: "partial"; value: string; percent: number | null }
  | { kind: "varies" }
  // A step that takes no one's traffic, as at 0% coverage.
  | { kind: "none" };

export type EnvironmentReason =
  | { kind: "disabled" }
  // An archived flag isn't sent to SDKs at all.
  | { kind: "archived" }
  // Prerequisites that keep everyone out.
  | {
      kind: "prerequisite";
      result: "unmet" | "cycle";
      // How many aren't met.
      count: number;
    }
  // The one thing that decides who gets what, behind any holdout: a rule or
  // prerequisite targeting that varies it, else the rule serving everyone.
  | { kind: "traffic"; labels: string[] }
  // Several things vary it together, too many to name as one reason.
  | { kind: "mixed" }
  | { kind: "default" };

// How each part of the evaluation bears on the outcome. "skipped" parts are
// never reached, e.g. everything after a disabled environment.
export type StepStatus =
  | "on"
  | "off"
  | "none"
  | "met"
  | "unmet"
  | "varies"
  | "applies"
  | "skipped";

export type EnvironmentStatus = {
  value: EnvironmentValue;
  reason: EnvironmentReason;
  environment: "on" | "off";
  prerequisites: StepStatus;
  holdout: StepStatus;
  rules: StepStatus;
  // Each step, and whether any traffic gets that far.
  steps: { step: TrafficStep; reachable: boolean }[];
  defaultValue: StepStatus;
  // The default as the SDK receives it.
  servedDefault: string;
};

const EPSILON = 1e-9;

// The share of hashes a namespace lets through.
function namespaceWidth(namespace?: NamespaceValue): number {
  if (!namespace?.enabled) return 1;
  return getNamespaceRanges(namespace).reduce(
    (sum, [start, end]) => sum + Math.max(0, end - start),
    0,
  );
}

const stepOf = (
  label: string,
  traffic: TrafficStep["traffic"],
  targeted: boolean,
): TrafficStep => ({
  kind: "rule",
  label,
  variations: null,
  targeted,
  traffic,
});

// The share of traffic a step takes, or null when that depends on who the
// user is. Reaching no one, its targeting doesn't matter.
function takes(step: TrafficStep): number | null {
  if (!step.traffic) return null;
  const participation = Math.min(step.traffic.participation, 1);
  if (step.targeted && participation > EPSILON) return null;
  return participation;
}

// How a step splits whoever reaches it, or null when that depends on who they
// are.
function decided(
  step: TrafficStep,
): { participation: number; shares: Share[] } | null {
  const participation = takes(step);
  const shares = step.traffic?.shares;
  return participation === null || !shares ? null : { participation, shares };
}

// A served value as the cards compare and show it, so equal values compare
// equal: a string as itself, anything else as its JSON on one line.
export function sdkValueText(
  valueType: FeatureValueType,
  served: unknown,
): string {
  if (valueType === "string" && typeof served === "string") return served;
  return JSON.stringify(served ?? null);
}

// How a rule splits the traffic that reaches it.
export function ruleTrafficStep(
  rule: FeatureRule,
  {
    experiment,
    safeRollout,
    namespaces,
    resolveValue = (value) => value,
  }: {
    experiment?: ExperimentInterfaceStringDates;
    safeRollout?: SafeRolloutInterface;
    // The org's namespace definitions, which decide each one's format.
    namespaces?: Map<string, { format?: "legacy" | "multiRange" }>;
    // A rule value as the SDK receives it, e.g. a sparse JSON patch merged
    // onto the default. `arm` is a value the payload treats as a patch on a
    // config-backed flag: every rule's value but a safe rollout's.
    resolveValue?: (
      value: string,
      options: { sparse: boolean; arm: boolean },
    ) => string;
  } = {},
): TrafficStep {
  const resolve = (value: string, arm = true) =>
    resolveValue(value, { sparse: "sparse" in rule && !!rule.sparse, arm });
  // Reaching nobody, a rule changes nothing, whatever its targeting.
  const none = { participation: 0, shares: [] };
  const targeted = hasTargetingConfigured(rule);
  if (rule.type === "force") {
    return stepOf(
      "Force rule",
      { participation: 1, shares: [{ value: resolve(rule.value), share: 1 }] },
      targeted,
    );
  }
  if (rule.type === "rollout") {
    return stepOf(
      "Rollout",
      {
        // Full coverage, or none set, serves everyone.
        participation: rule.coverage ?? 1,
        shares: [{ value: resolve(rule.value), share: 1 }],
      },
      targeted,
    );
  }
  if (rule.type === "experiment") {
    return {
      ...stepOf(
        "Experiment",
        {
          participation: (rule.coverage ?? 1) * namespaceWidth(rule.namespace),
          shares: rule.values.map((v) => ({
            value: resolve(v.value),
            share: v.weight,
          })),
        },
        targeted,
      ),
      variations: rule.values.length,
    };
  }
  if (rule.type === "experiment-ref") {
    const isBandit = experiment?.type === "multi-armed-bandit";
    const label = isBandit ? "Bandit" : "Experiment";
    const phase = experiment?.phases.at(-1);
    const refTargeted = targeted || (!!phase && hasTargetingConfigured(phase));
    const step = (traffic: TrafficStep["traffic"]): TrafficStep => ({
      ...stepOf(label, traffic, refTargeted),
      variations: experiment
        ? getLatestPhaseVariations(experiment).length
        : rule.variations.length,
    });
    if (!experiment || !phase) return step(null);
    const valueOf = (variationId: string) => {
      const value = rule.variations.find(
        (v) => v.variationId === variationId,
      )?.value;
      return value === undefined ? undefined : resolve(value);
    };
    const stopped = experiment.status === "stopped";
    // Stopped, it reaches the SDK as a force rule, which only a multi-range
    // namespace (a filter) narrows; the legacy tuple on it goes unread.
    const namespaced =
      phase.namespace &&
      (!stopped || isMultiRangeInPayload(phase.namespace, namespaces))
        ? phase.namespace
        : undefined;
    const participation = (phase.coverage ?? 1) * namespaceWidth(namespaced);
    // Stopped, it serves its released variation to the phase's traffic, or
    // isn't sent at all without one.
    const released =
      stopped && experiment.releasedVariationId
        ? valueOf(experiment.releasedVariationId)
        : undefined;
    const variations = getLatestPhaseVariations(experiment);
    if (
      participation === 0 ||
      (stopped && released === undefined) ||
      // The SDK skips an experiment with fewer than two variations.
      (!stopped && variations.length < 2)
    ) {
      return step(none);
    }
    if (released !== undefined) {
      return step({ participation, shares: [{ value: released, share: 1 }] });
    }
    // A bandit's weights move, so who gets what isn't known ahead of time.
    if (isBandit) return step({ participation, shares: null });
    // And splits evenly when the weights don't fit the variations.
    const weights = phase.variationWeights ?? [];
    const total = weights.reduce((sum, w) => sum + w, 0);
    const evenly =
      weights.length !== variations.length || total < 0.99 || total > 1.01;
    const shares: Share[] = [];
    for (const [i, variation] of variations.entries()) {
      const value = valueOf(variation.id);
      if (value === undefined) return step(null);
      shares.push({
        value,
        share: evenly ? 1 / variations.length : (weights[i] ?? 0),
      });
    }
    return step({ participation, shares });
  }

  if (rule.type === "safe-rollout") {
    // Decided, it serves one side to everyone.
    if (rule.status === "released" || rule.status === "rolled-back") {
      const value =
        rule.status === "released"
          ? resolve(rule.variationValue, false)
          : resolve(rule.controlValue, false);
      return stepOf(
        "Safe rollout",
        { participation: 1, shares: [{ value, share: 1 }] },
        targeted,
      );
    }
    // Running, it splits evenly at the current ramp-up step's coverage.
    const ramp = safeRollout?.rampUpSchedule;
    if (!ramp) return stepOf("Safe rollout", null, targeted);
    return stepOf(
      "Safe rollout",
      {
        participation:
          ramp.rampUpCompleted || !ramp.enabled
            ? 1
            : (ramp.steps[ramp.step]?.percent ?? 1),
        shares: [
          { value: resolve(rule.controlValue, false), share: 0.5 },
          { value: resolve(rule.variationValue, false), share: 0.5 },
        ],
      },
      targeted,
    );
  }
  return stepOf(
    rule.type === "contextual-bandit-ref" ? "Contextual bandit" : "Rule",
    null,
    targeted,
  );
}

// The holdout's control group is served the holdout value ahead of every rule.
export function holdoutTrafficStep(
  value: string,
  experiment?: ExperimentInterfaceStringDates,
): TrafficStep {
  // As the payload sends it: the main phase's coverage, split evenly.
  const phase = experiment?.phases[0];
  const step = {
    kind: "holdout" as const,
    label: "Holdout",
    variations: null,
    targeted: !!phase && hasTargetingConfigured(phase),
  };
  if (!phase) return { ...step, traffic: null };
  return {
    ...step,
    traffic: {
      participation: (phase.coverage ?? 1) * 0.5,
      shares: [{ value, share: 1 }],
    },
  };
}

// Shares that sum to the whole, merged by value and read as one summary.
function summarize(
  shares: Share[],
  isBoolean: boolean,
  exact: boolean,
  defaultValue: string,
  // A step splits its users between values, as a running experiment does.
  splits: boolean,
): EnvironmentValue {
  const merged = new Map<string, number>();
  for (const { value, share } of shares) {
    if (share <= EPSILON) continue;
    merged.set(value, (merged.get(value) ?? 0) + share);
  }
  if (merged.size === 1) {
    return { kind: "value", value: [...merged.keys()][0] };
  }
  if (isBoolean) {
    const on = merged.get("true") ?? 0;
    if (on <= EPSILON) return { kind: "value", value: "false" };
    if (on >= 1 - EPSILON) return { kind: "value", value: "true" };
    return { kind: "partial", value: "true", percent: exact ? on : null };
  }
  // One value over the default reads as that value for its share, unless
  // it's one side of a split, which singling out would misread.
  const others = [...merged.keys()].filter((v) => v !== defaultValue);
  if (!splits && merged.size === 2 && others.length === 1) {
    const share = merged.get(others[0]) ?? 0;
    return { kind: "partial", value: others[0], percent: exact ? share : null };
  }
  return { kind: "varies" };
}

// What a step serves whoever it reaches, or null when it serves nothing.
export function stepServes(
  step: TrafficStep,
  isBoolean: boolean,
): EnvironmentValue | null {
  const shares = step.traffic?.shares;
  if (!shares) return { kind: "varies" };
  if (!shares.some((s) => s.share > EPSILON)) return null;
  return summarize(shares, isBoolean, true, "", true);
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

// Who a step reaches, when that's known.
export function stepTargets(step: TrafficStep): string | null {
  const participation = step.traffic?.participation ?? null;
  if (participation !== null && participation <= EPSILON) return "No one";
  if (step.targeted) return "Specific users";
  if (participation === null) return null;
  if (participation >= 1 - EPSILON) return "All users";
  return `${percentFormatter.format(participation)} of users`;
}

// The rules that bear on a drilldown's outcome: not one that reaches no one,
// which the SDK drops, nor one no traffic gets as far as. A lone rule shows
// when who gets what from it is known: it takes everyone left, or a set
// share of them with the rest falling to the default. Otherwise they're
// counted. Past a holdout, only an outcome known that way shows at all.
export function reachedRules(status: EnvironmentStatus): {
  count: number;
  rule: TrafficStep | null;
  hidden: boolean;
} {
  const rules = status.steps.flatMap(({ step, reachable }) =>
    step.kind === "rule" && reachable && step.traffic?.participation !== 0
      ? [step]
      : [],
  );
  const rule =
    rules.length === 1 &&
    (status.defaultValue === "skipped" || decided(rules[0]) !== null)
      ? rules[0]
      : null;
  const holdout = status.steps.some(
    ({ step }) => step.kind === "holdout" && step.traffic?.participation !== 0,
  );
  return {
    count: rules.length,
    rule,
    hidden: holdout && rules.length > 0 && !rule,
  };
}

export function getEnvironmentStatus({
  enabled,
  archived = false,
  prerequisites,
  steps,
  defaultValue,
  isBoolean,
}: {
  enabled: boolean;
  archived?: boolean;
  prerequisites: { id: string; result: PrerequisiteResult }[];
  // The holdout, then the environment's live rules, in order.
  steps: TrafficStep[];
  defaultValue: string;
  isBoolean: boolean;
}): EnvironmentStatus {
  const has = (kind: TrafficStep["kind"]) => steps.some((s) => s.kind === kind);
  const unreached = {
    holdout: has("holdout") ? ("skipped" as const) : ("none" as const),
    rules: has("rule") ? ("skipped" as const) : ("none" as const),
    steps: [],
    defaultValue: "skipped" as const,
    servedDefault: defaultValue,
  };

  if (!enabled || archived) {
    return {
      value: { kind: "value", value: null },
      reason: { kind: enabled ? "archived" : "disabled" },
      environment: "off",
      prerequisites: prerequisites.length ? "skipped" : "none",
      ...unreached,
    };
  }

  const blocking = prerequisites.filter(
    (p) => p.result === "unmet" || p.result === "cycle",
  );
  if (blocking.length) {
    return {
      value: { kind: "value", value: null },
      reason: {
        kind: "prerequisite",
        result: blocking.some((p) => p.result === "cycle") ? "cycle" : "unmet",
        count: blocking.length,
      },
      environment: "on",
      prerequisites: "unmet",
      ...unreached,
    };
  }
  const varying = prerequisites.find((p) => p.result === "varies");

  // Each step takes its share of what's left; the default gets the rest.
  const walk = (list: TrafficStep[]) => {
    let remaining = 1;
    const shares: Share[] = [];
    const taking: TrafficStep[] = [];
    let variesAt: TrafficStep | null = null;
    let partialSteps = 0;
    for (const step of list) {
      if (remaining <= EPSILON) break;
      if ((takes(step) ?? 1) <= EPSILON) continue;
      const traffic = decided(step);
      if (!traffic) {
        variesAt = step;
        break;
      }
      const { participation } = traffic;
      for (const s of traffic.shares) {
        shares.push({
          value: s.value,
          share: remaining * participation * s.share,
        });
      }
      taking.push(step);
      if (participation < 1 - EPSILON) partialSteps++;
      remaining *= 1 - participation;
    }
    if (!variesAt && remaining > EPSILON) {
      shares.push({ value: defaultValue, share: remaining });
    }
    const value: EnvironmentValue = variesAt
      ? { kind: "varies" }
      : summarize(
          shares,
          isBoolean,
          partialSteps <= 1,
          defaultValue,
          taking.some(
            (step) =>
              new Set(
                decided(step)
                  ?.shares.filter((s) => s.share > EPSILON)
                  .map((s) => s.value),
              ).size > 1,
          ),
        );
    return { taking, variesAt, value };
  };
  const { taking, variesAt, value } = walk(steps);
  // Traffic gets past every step until one takes all of it.
  let open = true;
  const listed = steps.map((step) => {
    const reachable = open;
    if ((takes(step) ?? 0) >= 1 - EPSILON) open = false;
    return { step, reachable };
  });
  // Rules after the one that varies by user, which whoever it doesn't match
  // goes on to.
  const rulesAfter = variesAt
    ? listed
        .slice(steps.indexOf(variesAt) + 1)
        .filter(
          ({ step, reachable }) =>
            reachable &&
            step.kind === "rule" &&
            (step.traffic?.participation ?? 1) > EPSILON,
        ).length
    : 0;
  const sameValue = (a: EnvironmentValue, b: EnvironmentValue) =>
    JSON.stringify(a) === JSON.stringify(b);
  // A step whose users would get the same without it isn't a reason. Drop
  // them one at a time, so of two rules that do the same, one keeps it.
  let credited = steps;
  if (!variesAt) {
    for (const step of taking) {
      const without = credited.filter((s) => s !== step);
      if (sameValue(walk(without).value, value)) credited = without;
    }
  }
  const reasons = [
    ...(variesAt ? taking : walk(credited).taking),
    ...(variesAt ? [variesAt] : []),
  ];

  const statusOf = (kind: TrafficStep["kind"]): StepStatus => {
    if (!has(kind)) return "none";
    const own = listed.filter((r) => r.reachable && r.step.kind === kind);
    if (!own.length) return "skipped";
    return own.some((r) => !decided(r.step)) ? "varies" : "applies";
  };

  return {
    value: varying ? { kind: "varies" } : value,
    reason: (() => {
      const rules = reasons.filter((step) => step.kind === "rule");
      // What makes the value vary; a rule serving one value to all the
      // traffic left over doesn't, any more than the default does.
      const sources = [
        ...(varying ? ["Prerequisite targeting"] : []),
        ...rules
          .filter((step) => {
            const traffic = decided(step);
            return (
              !traffic ||
              traffic.participation < 1 - EPSILON ||
              new Set(traffic.shares.map((s) => s.value)).size > 1
            );
          })
          .map((step) => step.label),
      ];
      // Several vary it, or one does and the rules after it take over for
      // whoever it doesn't match: no single thing to name.
      if (sources.length > 1 || rulesAfter > 0) {
        return { kind: "mixed" as const };
      }
      // The holdout stacks in front, in the SDK's order.
      const chain = [
        ...reasons
          .filter((step) => step.kind === "holdout")
          .map((step) => step.label),
        ...(sources.length ? sources : rules.map((step) => step.label)),
      ].filter((label, i, all) => label !== all[i - 1]);
      return chain.length
        ? { kind: "traffic" as const, labels: chain }
        : { kind: "default" as const };
    })(),
    environment: "on",
    prerequisites: !prerequisites.length ? "none" : varying ? "varies" : "met",
    holdout: statusOf("holdout"),
    rules: statusOf("rule"),
    steps: listed,
    defaultValue: open ? "applies" : "skipped",
    servedDefault: defaultValue,
  };
}

// A value as the SDK hands it back; an environment serving nothing is null.
// JSON shows only when it's empty, as `null`, `{}` or `[]`; anything else is
// null, for the caller to name rather than cut short.
export function displayValue(
  value: string | null,
  valueType: FeatureValueType,
): string | null {
  if (value === null) return "null";
  if (valueType === "string") return JSON.stringify(value);
  if (valueType !== "json") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null) return "null";
    if (Array.isArray(parsed)) return parsed.length ? null : "[]";
    if (typeof parsed === "object" && !Object.keys(parsed).length) return "{}";
  } catch {
    // Not JSON the SDK could read either: named, not shown.
  }
  return null;
}

// Whether a non-boolean environment serves a value: to everyone (filled),
// maybe not to all when a prerequisite varies by user (half), or not at all,
// null (empty).
export function servedDot(
  status: EnvironmentStatus,
  valueType: FeatureValueType,
): "on" | "split" | "empty" {
  const { value } = status;
  // A JSON null serves nothing too.
  if (value.kind === "value") {
    return value.value === null ||
      (valueType === "json" && value.value === "null")
      ? "empty"
      : "on";
  }
  if (value.kind === "varies" && status.prerequisites === "varies") {
    return "split";
  }
  return "on";
}

export function reasonText(reason: EnvironmentReason): string | null {
  switch (reason.kind) {
    case "disabled":
      return "Environment OFF";
    case "archived":
      return "Feature Flag archived";
    case "prerequisite":
      return reason.result === "cycle"
        ? "Circular dependency"
        : reason.count > 1
          ? "Prerequisites not met"
          : "Prerequisite not met";
    case "traffic":
      return reason.labels.join(" + ");
    case "mixed":
      return null;
    case "default":
      return "Default value";
  }
}

// The prerequisites together: the first that keeps everyone out, else whether
// any depends on who the user is.
export function prerequisitesSummary(
  results: (PrerequisiteResult | null)[],
  overall: StepStatus,
): string {
  if (overall === "skipped") return "Not reachable";
  if (results.includes("cycle")) return "Circular dependency";
  if (results.includes("unmet")) return "Not met";
  if (results.includes("varies")) return "Met for some users";
  return results.length > 1 ? "All met" : "Met";
}
