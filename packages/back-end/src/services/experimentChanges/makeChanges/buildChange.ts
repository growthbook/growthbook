import isEqual from "lodash/isEqual";
import {
  Changeset,
  ExperimentInterface,
  ExperimentPhase,
} from "shared/types/experiment";
import { Namespaces } from "shared/types/organization";
import { PostExperimentChangesBody, ReleasePlan } from "shared/validators";
import {
  getEqualWeights,
  getLatestPhaseVariations,
  isVariationWeightsSumValid,
} from "shared/experiments";
import { getNamespaceRanges } from "shared/util";
import { BadRequestError } from "back-end/src/util/errors";
import { PhaseDelivery } from "./assessChange";

export type ExperimentForChange = Pick<
  ExperimentInterface,
  "phases" | "variations" | "bucketVersion" | "minBucketVersion"
>;

/** Every field a request can carry, whatever its change type. */
type RequestFields = Omit<
  Extract<PostExperimentChangesBody, { changeType: "advanced" }>,
  "changeType"
>;

type PlanMechanics = {
  newPhase: boolean;
  reseed: boolean;
  bumpBucketVersion: boolean;
  excludeExposed: boolean;
};

// What each plan does to the phase list, seed, and bucket versions, as the
// wizard's Review & Deploy page sets them.
const PLAN_MECHANICS: Record<ReleasePlan, PlanMechanics> = {
  "same-phase-keep-assignments": {
    newPhase: false,
    reseed: false,
    bumpBucketVersion: false,
    excludeExposed: false,
  },
  "same-phase-reassign": {
    newPhase: false,
    reseed: false,
    bumpBucketVersion: true,
    excludeExposed: false,
  },
  "new-phase-rerandomize": {
    newPhase: true,
    reseed: true,
    bumpBucketVersion: true,
    excludeExposed: false,
  },
  "new-phase-keep-assignments": {
    newPhase: true,
    reseed: false,
    bumpBucketVersion: false,
    excludeExposed: false,
  },
  "new-phase-exclude-exposed": {
    newPhase: true,
    reseed: true,
    bumpBucketVersion: true,
    excludeExposed: true,
  },
};

/** Applying a change with no plan: same phase, same seed, same buckets. */
const IN_PLACE = PLAN_MECHANICS["same-phase-keep-assignments"];

export function isNewPhasePlan(plan: ReleasePlan | null): boolean {
  return !!plan && PLAN_MECHANICS[plan].newPhase;
}

/** The latest phase's delivery fields, or the defaults a first phase starts from. */
export function currentDelivery(
  experiment: Pick<ExperimentInterface, "phases" | "variations">,
): PhaseDelivery {
  const phase = experiment.phases[experiment.phases.length - 1];
  return {
    condition: phase?.condition ?? "",
    savedGroups: phase?.savedGroups ?? [],
    prerequisites: phase?.prerequisites ?? [],
    coverage: phase?.coverage ?? 1,
    namespace: phase?.namespace,
    variationWeights:
      phase?.variationWeights ??
      getEqualWeights(getLatestPhaseVariations(experiment).length),
  };
}

function assertConditionIsObject(condition: string) {
  if (!condition) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(condition);
  } catch {
    throw new BadRequestError("targetingCondition must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BadRequestError("targetingCondition must be a JSON object.");
  }
}

function weightsFromTrafficSplit(
  trafficSplit: NonNullable<RequestFields["trafficSplit"]>,
  experiment: Pick<ExperimentInterface, "phases" | "variations">,
): number[] {
  const ids = getLatestPhaseVariations(experiment).map((v) => v.id);
  const sentIds = trafficSplit.map((s) => s.variationId);
  const unknown = sentIds.filter((id) => !ids.includes(id));
  if (unknown.length) {
    throw new BadRequestError(
      `Unknown variationId: ${unknown.join(", ")}. Use the ids in the experiment's \`variations\`.`,
    );
  }
  if (sentIds.length !== ids.length || new Set(sentIds).size !== ids.length) {
    throw new BadRequestError(
      `trafficSplit needs exactly one weight per variation: ${ids.join(", ")}.`,
    );
  }
  const weights = ids.map(
    (id) => trafficSplit.find((s) => s.variationId === id)?.weight ?? 0,
  );
  if (!isVariationWeightsSumValid(weights)) {
    throw new BadRequestError("trafficSplit weights must sum to 1.");
  }
  return weights;
}

function toPhaseNamespace(
  input: RequestFields["namespace"],
  orgNamespaces: Namespaces[],
  current: ExperimentPhase["namespace"],
): ExperimentPhase["namespace"] {
  if (!input) return { enabled: false, name: "", range: [0, 1] };

  const { namespaceId, ranges } = input;
  const orgNamespace = orgNamespaces.find((n) => n.name === namespaceId);
  if (!orgNamespace) {
    throw new BadRequestError(
      `Namespace "${namespaceId}" not found. Use the name of a namespace in your organization settings.`,
    );
  }
  const alreadyIn = !!current?.enabled && current.name === namespaceId;
  if (orgNamespace.status === "inactive" && !alreadyIn) {
    throw new BadRequestError(`Namespace "${namespaceId}" is inactive.`);
  }
  if (ranges.some(([start, end]) => start >= end)) {
    throw new BadRequestError(
      "Each namespace range must start before it ends.",
    );
  }

  if (orgNamespace.format === "multiRange") {
    return {
      enabled: true,
      name: namespaceId,
      format: "multiRange",
      hashAttribute: orgNamespace.hashAttribute,
      ranges,
    };
  }
  if (ranges.length > 1) {
    throw new BadRequestError(
      `Namespace "${namespaceId}" uses the legacy single-range format. Send one range.`,
    );
  }
  return { enabled: true, name: namespaceId, range: ranges[0] };
}

/**
 * The delivery fields the request sets. Omitted fields are absent, so they
 * keep their current values; `null` becomes the field's empty value.
 */
export function requestedDelivery(
  body: RequestFields,
  experiment: Pick<ExperimentInterface, "phases" | "variations">,
  orgNamespaces: Namespaces[],
): Partial<PhaseDelivery> {
  const touched: Partial<PhaseDelivery> = {};
  if (body.coverage !== undefined) touched.coverage = body.coverage;
  if (body.trafficSplit !== undefined) {
    touched.variationWeights = weightsFromTrafficSplit(
      body.trafficSplit,
      experiment,
    );
  }
  if (body.targetingCondition !== undefined) {
    touched.condition = body.targetingCondition ?? "";
    assertConditionIsObject(touched.condition);
  }
  if (body.savedGroups !== undefined) {
    touched.savedGroups = body.savedGroups ?? [];
  }
  if (body.prerequisites !== undefined) {
    touched.prerequisites = body.prerequisites ?? [];
  }
  if (body.namespace !== undefined) {
    touched.namespace = toPhaseNamespace(
      body.namespace,
      orgNamespaces,
      experiment.phases[experiment.phases.length - 1]?.namespace,
    );
  }
  return touched;
}

const sameCondition = (a: string, b: string) => {
  const normalize = (c: string) => {
    try {
      return JSON.stringify(JSON.parse(c || "{}"));
    } catch {
      return c;
    }
  };
  return normalize(a) === normalize(b);
};

const sameNamespace = (
  a: ExperimentPhase["namespace"],
  b: ExperimentPhase["namespace"],
) => {
  if (!a?.enabled || !b?.enabled) return !a?.enabled && !b?.enabled;
  return (
    a.name === b.name && isEqual(getNamespaceRanges(a), getNamespaceRanges(b))
  );
};

/** Whether `proposed` serves anyone differently than `current`. */
export function deliveryChanged(
  current: PhaseDelivery,
  proposed: PhaseDelivery,
): boolean {
  return !(
    sameCondition(current.condition, proposed.condition) &&
    isEqual(current.savedGroups ?? [], proposed.savedGroups ?? []) &&
    isEqual(current.prerequisites ?? [], proposed.prerequisites ?? []) &&
    current.coverage === proposed.coverage &&
    sameNamespace(current.namespace, proposed.namespace) &&
    isEqual(current.variationWeights, proposed.variationWeights)
  );
}

export type BuildChangeInput = {
  experiment: ExperimentForChange;
  touched: Partial<PhaseDelivery>;
  /** null applies the change in place. */
  plan: ReleasePlan | null;
  stickyBucketing: boolean;
  newSeed: string;
  now: Date;
  reason?: string;
};

/** The experiment fields to write so the change rolls out under `plan`. */
export function buildChange({
  experiment,
  touched,
  plan,
  stickyBucketing,
  newSeed,
  now,
  reason,
}: BuildChangeInput): Changeset {
  const mechanics = plan ? PLAN_MECHANICS[plan] : IN_PLACE;
  const phases = [...experiment.phases];
  const last = phases[phases.length - 1];

  if (!last) {
    // A draft with no phase yet gets its first one.
    phases.push({
      ...currentDelivery(experiment),
      ...touched,
      name: "Main",
      dateStarted: now,
      reason: "",
      variations: experiment.variations.map((v) => ({
        id: v.id,
        status: "active" as const,
      })),
    });
  } else if (!mechanics.newPhase) {
    phases[phases.length - 1] = { ...last, ...touched };
  } else {
    phases[phases.length - 1] = {
      ...last,
      dateEnded: now,
      reason: reason || last.reason || "",
    };
    phases.push({
      ...currentDelivery(experiment),
      ...touched,
      name: "Main",
      dateStarted: now,
      reason: "",
      variations: last.variations,
      seed: mechanics.reseed ? newSeed : last.seed,
    });
  }

  const changes: Changeset = { phases };
  // Bucket versions only mean something to Sticky Bucketing.
  if (stickyBucketing && mechanics.bumpBucketVersion) {
    changes.bucketVersion = (experiment.bucketVersion ?? 0) + 1;
    if (mechanics.excludeExposed) {
      changes.minBucketVersion = changes.bucketVersion;
    }
  }
  return changes;
}
