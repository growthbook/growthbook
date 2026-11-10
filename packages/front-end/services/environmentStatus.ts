import {
  FeatureInterface,
  FeatureRule,
  FeatureValueType,
} from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  HoldoutInterface,
  NamespaceValue,
  SafeRolloutInterface,
} from "shared/validators";
import {
  getLatestPhaseVariations,
  hasTargetingConfigured,
} from "shared/experiments";
import {
  getNamespaceRanges,
  parsePlainJSONObject,
  ruleProjectScope,
  stripConfigExtends,
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
// (`participation`) and the values that share is served — or null when that
// depends on who the user is.
export type TrafficStep = {
  kind: "holdout" | "rule";
  // The gist, for a summary: "Experiment", "Holdout".
  label: string;
  // What it is, for a closer look: the experiment's or holdout's name, and
  // where to find it.
  name: string | null;
  href: string | null;
  traffic: { participation: number; shares: Share[] } | null;
};

// What an environment serves: one value to everyone (null when it serves
// nothing), one value to a share of users, several values in known shares, or
// something that depends on who the user is.
export type EnvironmentValue =
  | { kind: "value"; value: string | null }
  // Null when the share can't be known: steps that each take part of the
  // traffic overlap however their hashes happen to line up.
  | { kind: "partial"; value: string; percent: number | null }
  | { kind: "split"; count: number }
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
  // What decides who gets what, in order: prerequisite targeting, the holdout,
  // then the rules that take traffic, ending at whichever one varies by user.
  | { kind: "traffic"; labels: string[] }
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
  // Each step reached, with what it serves whoever reaches it.
  steps: { step: TrafficStep; value: EnvironmentValue }[];
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
  name: string | null = null,
  href: string | null = null,
): TrafficStep => ({ kind: "rule", label, name, href, traffic });

// A value as the SDK receives it, so equal values compare equal: JSON as one
// string however it was spaced, constant references resolved, and a sparse
// rule's patch spread over the resolved default.
export function resolveRuleValue(
  feature: Pick<FeatureInterface, "valueType" | "defaultValue">,
  value: string,
  sparse = false,
  // Resolves `@const:` references, as the payload does.
  resolveRefs: (value: unknown) => unknown = (v) => v,
): string {
  if (feature.valueType === "number") return String(parseFloat(value) || 0);
  if (feature.valueType === "boolean") {
    return value === "false" ? "false" : "true";
  }
  if (feature.valueType === "string") {
    const resolved = resolveRefs(value);
    return typeof resolved === "string" ? resolved : value;
  }
  // A flag that isn't config-backed never resolves a config.
  const plain = (v: string) => stripConfigExtends(v) ?? v;
  const asObject = (v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  const defaultObject = parsePlainJSONObject(plain(feature.defaultValue));
  const patch = sparse ? parsePlainJSONObject(plain(value)) : null;
  if (defaultObject && patch) {
    const resolvedPatch = resolveRefs(patch);
    const patchObject = asObject(resolvedPatch);
    return JSON.stringify(
      patchObject
        ? { ...(asObject(resolveRefs(defaultObject)) ?? {}), ...patchObject }
        : resolvedPatch,
    );
  }
  try {
    return JSON.stringify(resolveRefs(JSON.parse(plain(value))));
  } catch {
    // Invalid JSON reaches the SDK as null.
    return "null";
  }
}

// How a rule splits the traffic that reaches it.
export function ruleTrafficStep(
  rule: FeatureRule,
  {
    experiment,
    safeRollout,
    resolveValue = (value) => value,
  }: {
    experiment?: ExperimentInterfaceStringDates;
    safeRollout?: SafeRolloutInterface;
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
  if (rule.type === "force") {
    return stepOf(
      "Force rule",
      hasTargetingConfigured(rule)
        ? null
        : {
            participation: 1,
            shares: [{ value: resolve(rule.value), share: 1 }],
          },
    );
  }
  if (rule.type === "rollout") {
    return stepOf(
      "Rollout",
      rule.coverage === 0
        ? none
        : hasTargetingConfigured(rule)
          ? null
          : {
              // Full coverage, or none set, serves everyone.
              participation: rule.coverage ?? 1,
              shares: [{ value: resolve(rule.value), share: 1 }],
            },
    );
  }
  if (rule.type === "experiment") {
    const participation = (rule.coverage ?? 1) * namespaceWidth(rule.namespace);
    return stepOf(
      "Experiment",
      participation === 0
        ? none
        : hasTargetingConfigured(rule)
          ? null
          : {
              participation,
              shares: rule.values.map((v) => ({
                value: resolve(v.value),
                share: v.weight,
              })),
            },
    );
  }
  if (rule.type === "experiment-ref") {
    const isBandit = experiment?.type === "multi-armed-bandit";
    const label = isBandit ? "Bandit" : "Experiment";
    const name = experiment?.name ?? null;
    const href = experiment ? `/experiment/${experiment.id}` : null;
    const phase = experiment?.phases.at(-1);
    if (!experiment || !phase) return stepOf(label, null, name, href);
    const valueOf = (variationId: string) => {
      const value = rule.variations.find(
        (v) => v.variationId === variationId,
      )?.value;
      return value === undefined ? undefined : resolve(value);
    };
    const participation =
      (phase.coverage ?? 1) * namespaceWidth(phase.namespace);
    const stopped = experiment.status === "stopped";
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
      return stepOf(label, none, name, href);
    }
    if (hasTargetingConfigured(rule) || hasTargetingConfigured(phase)) {
      return stepOf(label, null, name, href);
    }
    if (released !== undefined) {
      return stepOf(
        label,
        { participation, shares: [{ value: released, share: 1 }] },
        name,
        href,
      );
    }
    // A bandit's weights move, so who gets what isn't known ahead of time.
    if (isBandit) return stepOf(label, null, name, href);
    // And splits evenly when the weights don't fit the variations.
    const weights = phase.variationWeights ?? [];
    const total = weights.reduce((sum, w) => sum + w, 0);
    const evenly =
      weights.length !== variations.length || total < 0.99 || total > 1.01;
    const shares: Share[] = [];
    for (const [i, variation] of variations.entries()) {
      const value = valueOf(variation.id);
      if (value === undefined) return stepOf(label, null, name, href);
      shares.push({
        value,
        share: evenly ? 1 / variations.length : (weights[i] ?? 0),
      });
    }
    return stepOf(label, { participation, shares }, name, href);
  }

  if (rule.type === "safe-rollout") {
    if (hasTargetingConfigured(rule)) return stepOf("Safe rollout", null);
    // Decided, it serves one side to everyone.
    if (rule.status === "released" || rule.status === "rolled-back") {
      const value =
        rule.status === "released"
          ? resolve(rule.variationValue, false)
          : resolve(rule.controlValue, false);
      return stepOf("Safe rollout", {
        participation: 1,
        shares: [{ value, share: 1 }],
      });
    }
    // Running, it splits evenly at the current ramp-up step's coverage.
    const ramp = safeRollout?.rampUpSchedule;
    if (!ramp) return stepOf("Safe rollout", null);
    return stepOf("Safe rollout", {
      participation:
        ramp.rampUpCompleted || !ramp.enabled
          ? 1
          : (ramp.steps[ramp.step]?.percent ?? 1),
      shares: [
        { value: resolve(rule.controlValue, false), share: 0.5 },
        { value: resolve(rule.variationValue, false), share: 0.5 },
      ],
    });
  }
  return stepOf(
    rule.type === "contextual-bandit-ref" ? "Contextual bandit" : "Rule",
    null,
  );
}

// The holdout's control group is served the holdout value ahead of every rule.
export function holdoutTrafficStep(
  holdout: Pick<HoldoutInterface, "id" | "name">,
  value: string,
  experiment?: ExperimentInterfaceStringDates,
): TrafficStep {
  const step = {
    kind: "holdout" as const,
    label: "Holdout",
    name: holdout.name,
    href: `/holdout/${holdout.id}`,
  };
  // As the payload sends it: the main phase's coverage, split evenly.
  const phase = experiment?.phases[0];
  if (!phase || hasTargetingConfigured(phase)) {
    return { ...step, traffic: null };
  }
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
  return { kind: "split", count: merged.size };
}

// What one step serves whoever reaches it; the share it doesn't take falls
// through.
function stepValue(step: TrafficStep, isBoolean: boolean): EnvironmentValue {
  if (!step.traffic) return { kind: "varies" };
  const { participation, shares } = step.traffic;
  const values = [
    ...new Set(shares.filter((s) => s.share > EPSILON).map((s) => s.value)),
  ];
  if (participation <= EPSILON || !values.length) return { kind: "none" };
  if (values.length === 1) {
    return participation >= 1 - EPSILON
      ? { kind: "value", value: values[0] }
      : { kind: "partial", value: values[0], percent: participation };
  }
  if (isBoolean) {
    const on = shares
      .filter((s) => s.value === "true")
      .reduce((sum, s) => sum + s.share * participation, 0);
    return { kind: "partial", value: "true", percent: on };
  }
  return { kind: "split", count: values.length };
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
    const reached: EnvironmentStatus["steps"] = [];
    const taking: TrafficStep[] = [];
    let variesAt: TrafficStep | null = null;
    let partialSteps = 0;
    for (const step of list) {
      if (remaining <= EPSILON) break;
      reached.push({ step, value: stepValue(step, isBoolean) });
      if (!step.traffic) {
        variesAt = step;
        break;
      }
      const participation = Math.min(step.traffic.participation, 1);
      if (participation <= EPSILON) continue;
      for (const s of step.traffic.shares) {
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
                step.traffic?.shares
                  .filter((s) => s.share > EPSILON)
                  .map((s) => s.value),
              ).size > 1,
          ),
        );
    return { reached, taking, variesAt, remaining, value };
  };
  const { reached, taking, variesAt, remaining, value } = walk(steps);
  const reachesDefault = !!variesAt || remaining > EPSILON;
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
    const own = reached.filter((r) => r.step.kind === kind);
    if (!own.length) return "skipped";
    return own.some((r) => !r.step.traffic) ? "varies" : "applies";
  };

  return {
    value: varying ? { kind: "varies" } : value,
    reason: (() => {
      // In the SDK's order: the holdout comes before prerequisite gates.
      const labelsOf = (kind: TrafficStep["kind"]) =>
        reasons.filter((step) => step.kind === kind).map((step) => step.label);
      const chain = [
        ...labelsOf("holdout"),
        ...(varying ? ["Prerequisite targeting"] : []),
        ...labelsOf("rule"),
      ].filter((label, i, all) => label !== all[i - 1]);
      return chain.length
        ? { kind: "traffic" as const, labels: chain }
        : { kind: "default" as const };
    })(),
    environment: "on",
    prerequisites: !prerequisites.length ? "none" : varying ? "varies" : "met",
    holdout: statusOf("holdout"),
    rules: statusOf("rule"),
    steps: reached,
    defaultValue: reachesDefault ? "applies" : "skipped",
    servedDefault: defaultValue,
  };
}

// JSON on one line, spaced like it reads aloud: {"a": 1, "b": [2]}.
export function oneLineJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 1)
      .replace(/([[{])\n\s*/g, "$1")
      .replace(/\n\s*([\]}])/g, "$1")
      .replace(/\n\s*/g, " ");
  } catch {
    return value.replace(/\s+/g, " ");
  }
}

// A value as the SDK hands it back; an environment serving nothing is null.
export function displayValue(
  value: string | null,
  valueType: FeatureValueType,
) {
  if (value === null) return "null";
  if (valueType === "string") return JSON.stringify(value);
  if (valueType === "json") return oneLineJson(value);
  return value;
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

// The "why" beside a card's value.
export function reasonText(reason: EnvironmentReason): string {
  switch (reason.kind) {
    case "disabled":
      return "Environment OFF";
    case "archived":
      return "Feature archived";
    case "prerequisite":
      return reason.result === "cycle"
        ? "Circular dependency"
        : reason.count > 1
          ? "Prerequisites not met"
          : "Prerequisite not met";
    case "traffic":
      return reason.labels.join(" + ");
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
  if (overall === "skipped") return "Not reached";
  if (results.includes("cycle")) return "Circular dependency";
  if (results.includes("unmet")) return "Not met";
  if (results.includes("varies")) return "Varies by user";
  return results.length > 1 ? "All met" : "Met";
}
