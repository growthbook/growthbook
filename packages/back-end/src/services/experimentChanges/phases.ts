import uniqid from "uniqid";
import { v4 as uuidv4 } from "uuid";
import { getScopedSettings } from "shared/settings";
import {
  Changeset,
  ExperimentInterface,
  ExperimentPhase,
  ExperimentStatus,
} from "shared/types/experiment";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { updateSnapshotsOnPhaseDelete } from "back-end/src/models/ExperimentSnapshotModel";
import {
  assertCanRunExperimentInAffectedEnvironments,
  assertValidExperimentPhases,
  getExperimentAttributeScopeProjects,
  resetExperimentBanditSettings,
} from "back-end/src/services/experiments";
import { assertRegisteredAttributesScoped } from "back-end/src/services/attributes";
import { assertValidExperimentPrerequisites } from "back-end/src/services/prerequisiteParents";
import { validateChangedPhaseReferences } from "back-end/src/api/features/validations";
import {
  BadRequestError,
  ConflictError,
  InvalidStatusError,
  NotFoundError,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  loadAndValidateExperimentForStatusChange,
  validateExperimentChange,
} from "./changeExperimentStatus";

type Context = ReqContext | ApiReqContext;
type Settings = ReturnType<typeof getScopedSettings>["settings"];

/**
 * Reopens the last phase of a stopped experiment. Bandits can't continue a
 * phase, so they get a fresh one with new buckets instead.
 */
export function getRestartChanges(
  experiment: ExperimentInterface,
  settings: Settings,
): Changeset {
  const changes: Changeset = {};
  const phases = [...experiment.phases];
  if (!phases.length) return changes;

  const lastIndex = phases.length - 1;
  const clonedPhase = { ...phases[lastIndex] };
  delete clonedPhase.dateEnded;
  phases[lastIndex] = clonedPhase;
  changes.phases = phases;

  if (experiment.type === "multi-armed-bandit") {
    clonedPhase.dateEnded = new Date();
    phases.push({
      condition: clonedPhase.condition,
      savedGroups: clonedPhase.savedGroups,
      prerequisites: clonedPhase.prerequisites,
      coverage: clonedPhase.coverage,
      dateStarted: new Date(),
      name: "Main",
      namespace: clonedPhase.namespace,
      reason: "",
      variationWeights: clonedPhase.variationWeights,
      variations: clonedPhase.variations,
      seed: uuidv4(),
    });
    changes.bucketVersion = (experiment.bucketVersion ?? 0) + 1;
    changes.minBucketVersion = (experiment.bucketVersion ?? 0) + 1;
    Object.assign(
      changes,
      resetExperimentBanditSettings({ experiment, changes, settings }),
    );
  }
  return changes;
}

export async function restartExperiment({
  context,
  experimentId,
  status,
}: {
  context: ReqContext;
  experimentId: string;
  status: Extract<ExperimentStatus, "running" | "draft">;
}) {
  const experiment = await loadAndValidateExperimentForStatusChange(
    context,
    experimentId,
  );
  if (experiment.status !== "stopped") {
    throw new InvalidStatusError(
      "Only a stopped experiment can be restarted",
      experiment.status,
      ["stopped"],
    );
  }
  const { settings } = getScopedSettings({
    organization: context.org,
    experiment,
  });

  const changes: Changeset = {
    ...getRestartChanges(experiment, settings),
    status,
    ...(experiment.nextScheduledStatusUpdate
      ? { nextScheduledStatusUpdate: null }
      : {}),
  };
  await validateExperimentChange({ context, experiment, changes });
  const updated = await updateExperiment({ context, experiment, changes });
  return { experiment, updated };
}

// Mirrors the "Release changes" plans in the app's targeting editor.
export const NEW_PHASE_RELEASE_PLANS = [
  "new-phase",
  "new-phase-same-seed",
  "new-phase-block-sticky",
] as const;
export type NewPhaseReleasePlan = (typeof NEW_PHASE_RELEASE_PLANS)[number];

export function getNewPhaseBucketing(
  plan: NewPhaseReleasePlan,
  experiment: Pick<
    ExperimentInterface,
    "bucketVersion" | "minBucketVersion" | "disableStickyBucketing"
  >,
  orgUsesStickyBucketing: boolean,
) {
  const reseed = plan !== "new-phase-same-seed";
  const unchanged = {
    bucketVersion: experiment.bucketVersion,
    minBucketVersion: experiment.minBucketVersion,
  };
  if (!orgUsesStickyBucketing || experiment.disableStickyBucketing) {
    return { reseed, ...unchanged };
  }
  const next = (experiment.bucketVersion ?? 0) + 1;
  switch (plan) {
    case "new-phase":
      return {
        reseed,
        bucketVersion: next,
        minBucketVersion: experiment.minBucketVersion ?? 0,
      };
    case "new-phase-block-sticky":
      return { reseed, bucketVersion: next, minBucketVersion: next };
    case "new-phase-same-seed":
      return { reseed, ...unchanged };
  }
}

export type NewPhaseTargeting = Partial<
  Pick<
    ExperimentPhase,
    | "condition"
    | "savedGroups"
    | "prerequisites"
    | "coverage"
    | "namespace"
    | "variationWeights"
  >
>;

/** Ends the running phase and starts another, carrying over any targeting not overridden. */
export async function startNewExperimentPhase({
  context,
  experimentId,
  releasePlan,
  reason,
  targeting,
}: {
  context: ReqContext;
  experimentId: string;
  releasePlan: NewPhaseReleasePlan;
  reason?: string;
  targeting: NewPhaseTargeting;
}) {
  const experiment = await loadAndValidateExperimentForStatusChange(
    context,
    experimentId,
  );
  if (experiment.status !== "running" || !experiment.phases.length) {
    throw new InvalidStatusError(
      "Can only start a new phase on a running experiment",
      experiment.status,
      ["running"],
    );
  }
  const last = experiment.phases[experiment.phases.length - 1];
  const next = {
    condition: targeting.condition ?? last.condition,
    savedGroups: targeting.savedGroups ?? last.savedGroups,
    prerequisites: targeting.prerequisites ?? last.prerequisites,
    coverage: targeting.coverage ?? last.coverage,
    namespace: targeting.namespace ?? last.namespace,
    variationWeights: targeting.variationWeights ?? last.variationWeights,
  };
  if (next.variationWeights.length !== last.variations.length) {
    throw new BadRequestError(
      `variationWeights needs one weight per variation (${last.variations.length})`,
    );
  }

  const linkedFeatures = await getFeaturesByIds(
    context,
    experiment.linkedFeatures || [],
  );
  await assertRegisteredAttributesScoped(
    context,
    { condition: next.condition },
    "experiment phase",
    { condition: last.condition },
    () =>
      getExperimentAttributeScopeProjects(context, experiment, linkedFeatures),
  );
  await validateChangedPhaseReferences([next], [last], context);
  await assertValidExperimentPrerequisites(
    context,
    next.prerequisites,
    last.prerequisites,
  );

  const { reseed, bucketVersion, minBucketVersion } = getNewPhaseBucketing(
    releasePlan,
    experiment,
    !!context.org.settings?.useStickyBucketing,
  );
  const now = new Date();
  const phases = [...experiment.phases];
  phases[phases.length - 1] = { ...last, dateEnded: now, reason: reason ?? "" };
  phases.push({
    ...next,
    dateStarted: now,
    name: "Main",
    reason: "",
    variations: last.variations,
    seed: reseed ? uuidv4() : last.seed,
  });
  assertValidExperimentPhases(phases, experiment.phases);

  const changes: Changeset = { phases, bucketVersion, minBucketVersion };
  if (experiment.type === "multi-armed-bandit") {
    const { settings } = getScopedSettings({
      organization: context.org,
      experiment,
    });
    Object.assign(
      changes,
      resetExperimentBanditSettings({ experiment, changes, settings }),
    );
  }

  await validateExperimentChange({ context, experiment, changes });
  const updated = await updateExperiment({ context, experiment, changes });
  return { experiment, updated };
}

/**
 * Removes a phase along with the snapshots and incremental-refresh state tied
 * to it, which replacing the phases array on update would leave behind.
 */
export async function deleteExperimentPhase({
  context,
  experimentId,
  phaseIndex,
}: {
  context: Context;
  experimentId: string;
  phaseIndex: number;
}) {
  const experiment = await getExperimentById(context, experimentId);
  if (!experiment || experiment.organization !== context.org.id) {
    throw new NotFoundError("Experiment not found");
  }
  const changes: Changeset = {};
  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }
  if (experiment.phases.length === 1) {
    throw new BadRequestError("Cannot delete the only phase");
  }
  await assertCanRunExperimentInAffectedEnvironments(context, experiment);
  if (
    !Number.isInteger(phaseIndex) ||
    phaseIndex < 0 ||
    phaseIndex >= experiment.phases.length
  ) {
    throw new BadRequestError("Invalid phase id");
  }

  changes.phases = experiment.phases.filter((_, i) => i !== phaseIndex);
  await validateExperimentChange({ context, experiment, changes });

  const mutationToken = uniqid("irdel_");
  const claimed =
    await context.models.incrementalRefresh.acquirePhaseSlotForMutation(
      experimentId,
      phaseIndex,
      mutationToken,
    );
  if (!claimed) {
    throw new ConflictError(
      "An incremental refresh is running for this phase. Wait for it to finish before deleting the phase.",
    );
  }

  try {
    const updated = await updateExperiment({ context, experiment, changes });
    await updateSnapshotsOnPhaseDelete(context, experimentId, phaseIndex);
    await context.models.incrementalRefresh.deleteByExperimentIdAndPhase(
      experimentId,
      phaseIndex,
    );
    await context.models.incrementalRefresh.shiftPhasesDownAfterDelete(
      experimentId,
      phaseIndex,
    );
    return { experiment, updated };
  } finally {
    // The delete removes a successful claim; otherwise release it.
    await context.models.incrementalRefresh
      .releaseLock(experimentId, mutationToken)
      .catch((e) =>
        logger.warn(
          e,
          "Failed to release the incremental refresh phase mutation claim",
        ),
      );
  }
}
