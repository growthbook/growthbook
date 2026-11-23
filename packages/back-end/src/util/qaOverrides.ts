import {
  ConditionInterface,
  ParentConditionInterface,
} from "@growthbook/growthbook";
import { cloneDeep, isUndefined, omit, omitBy, pick } from "lodash";
import {
  getQaTrackingKey,
  qaOverrideHasOwnTargeting,
  qaOverrideVariationMissing,
} from "shared/util";
import { getLatestPhaseVariations } from "shared/experiments";
import { ExperimentInterface, ExperimentPhase } from "shared/types/experiment";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { SavedGroupTargeting } from "shared/types/feature";
import { QaOverrideMetadata } from "shared/types/sdk";

// How one QA override is served. Flag rules and auto experiments are both
// built from this, so they always agree on who an override applies to.
export type QaServing = {
  override: ExperimentQaOverrideInterface;
  // The experiment's latest phase, adjusted to what this override serves.
  phase: ExperimentPhase;
  // Who the override applies to. undefined is everyone.
  match: ConditionInterface | undefined;
  // Testers an earlier override applies to. They get that one or nothing.
  exclude: ConditionInterface | undefined;
};

export type QaPlans = Map<string, QaServing[]>;

type CompileTargeting = (targeting: {
  condition?: string;
  savedGroups?: SavedGroupTargeting[];
}) => ConditionInterface | undefined;

function qaOverrideWeights(
  override: ExperimentQaOverrideInterface,
  experiment: ExperimentInterface,
  phase: ExperimentPhase,
): number[] {
  const { assignment } = override;
  if (assignment.type !== "forced") return phase.variationWeights;
  return getLatestPhaseVariations(experiment).map((v) =>
    v.id === assignment.variationId ? 1 : 0,
  );
}

// Targeting of its own replaces the experiment's attribute and Saved Group
// targeting, and with it the traffic split, namespace and prerequisites that
// would keep a tester out. So does forcing a variation, which applies to
// everyone unless narrowed. Random assignment with no targeting serves the
// experiment as configured.
export function qaOverridePhase(
  override: ExperimentQaOverrideInterface,
  experiment: ExperimentInterface,
  phase: ExperimentPhase,
): ExperimentPhase {
  const ownTargeting = qaOverrideHasOwnTargeting(override.filters);
  if (!ownTargeting && override.assignment.type === "random") return phase;

  return {
    ...omit(phase, ["namespace", "prerequisites"]),
    condition: (ownTargeting && override.filters.condition) || "",
    savedGroups: ownTargeting ? override.filters.savedGroups : undefined,
    coverage: 1,
    variationWeights: qaOverrideWeights(override, experiment, phase),
  };
}

// undefined: nobody is excluded. null: everybody is.
export function excludeQaMatches(
  matches: (ConditionInterface | undefined)[],
): ConditionInterface | null | undefined {
  if (!matches.length) return undefined;
  const conditions: ConditionInterface[] = [];
  for (const match of matches) {
    if (!match) return null;
    // Copied, because conditions are finalized in place once embedded.
    conditions.push(cloneDeep(match));
  }
  return {
    $not: conditions.length === 1 ? conditions[0] : { $or: conditions },
  };
}

// A tester gets the first override they match. Matching is by targeting
// alone: one who matches but is not bucketed gets nothing from the experiment
// and does not fall through to a later override.
export function planQaOverrides({
  experiment,
  overrides,
  compileTargeting,
}: {
  experiment: ExperimentInterface;
  // In priority order.
  overrides: ExperimentQaOverrideInterface[];
  compileTargeting: CompileTargeting;
}): QaServing[] {
  const phase = experiment.phases[experiment.phases.length - 1];
  if (!phase) return [];

  const servings: QaServing[] = [];
  const earlier: ConditionInterface[] = [];
  for (const override of overrides) {
    if (qaOverrideVariationMissing(override, experiment)) continue;
    const servingPhase = qaOverridePhase(override, experiment, phase);
    const match = compileTargeting(servingPhase);
    servings.push({
      override,
      phase: servingPhase,
      match,
      exclude: excludeQaMatches(earlier) ?? undefined,
    });
    // Nobody is left for the overrides below one that matches everyone.
    if (!match) break;
    earlier.push(match);
  }
  return servings;
}

export function planQaOverridesByExperiment({
  experiments,
  overrides,
  compileTargeting,
}: {
  experiments: Map<string, ExperimentInterface>;
  overrides: Map<string, ExperimentQaOverrideInterface[]> | undefined;
  compileTargeting: CompileTargeting;
}): QaPlans | undefined {
  if (!overrides?.size) return undefined;
  const plans: QaPlans = new Map();
  overrides.forEach((experimentOverrides, experimentId) => {
    const experiment = experiments.get(experimentId);
    if (experiment?.status !== "draft") return;
    const servings = planQaOverrides({
      experiment,
      overrides: experimentOverrides,
      compileTargeting,
    });
    if (servings.length) plans.set(experimentId, servings);
  });
  return plans.size ? plans : undefined;
}

// Turns a rule or auto experiment built from `serving.phase` into the QA copy.
export function applyQaServing<
  T extends {
    key?: string;
    seed?: string;
    condition?: ConditionInterface;
    disableStickyBucketing?: boolean;
  },
>(rule: T, experiment: ExperimentInterface, serving: QaServing): T {
  // QA exposures are tracked apart from the experiment's results.
  rule.key = getQaTrackingKey(experiment.trackingKey);
  // The seed the live experiment hashes with, so a tester keeps their
  // variation once it starts.
  rule.seed = serving.phase.seed || experiment.trackingKey;
  rule.disableStickyBucketing = true;
  if (serving.exclude) {
    const exclude = cloneDeep(serving.exclude);
    rule.condition = rule.condition
      ? { $and: [rule.condition, exclude] }
      : exclude;
  }
  return rule;
}

// `configured` is the same rule or auto experiment built from the experiment's
// own phase: what it serves without the override.
export function qaOverrideMetadata(
  configured: Omit<QaOverrideMetadata, "id" | "type" | "key" | "status">,
  experiment: ExperimentInterface,
  serving: QaServing,
): QaOverrideMetadata {
  return {
    id: serving.override.id,
    type: serving.override.assignment.type,
    key: experiment.trackingKey,
    status: experiment.status,
    ...omitBy(
      pick(configured, [
        "weights",
        "coverage",
        "condition",
        "parentConditions",
        "namespace",
        "filters",
        "disableStickyBucketing",
        "changeId",
      ]),
      isUndefined,
    ),
  };
}

type Targeting = {
  condition?: ConditionInterface;
  parentConditions?: ParentConditionInterface[];
};

// Every place a rule or auto experiment carries targeting: its own, and the
// experiment's kept under `metadata.qaOverride`. Whatever reads or rewrites
// payload conditions has to cover both, or the second one ships with Saved
// Groups unresolved and secure attributes unhashed.
export function targetingOf(
  rule: Targeting & { metadata?: { qaOverride?: Targeting } },
): Targeting[] {
  return rule.metadata?.qaOverride ? [rule, rule.metadata.qaOverride] : [rule];
}
