import { v4 as uuidv4 } from "uuid";
import isEqual from "lodash/isEqual";
import { getValidDate } from "shared/dates";
import { getActivePhase } from "shared/experiments";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import {
  DEFAULT_HOLDOUT_SIZE,
  generateVariationId,
  getEnabledHoldoutEnvironments,
  getHoldoutStage,
  holdoutSizeToCoverage,
  HoldoutStage,
  validateCondition,
} from "shared/util";
import {
  ApiUpdateHoldoutBody,
  CreateHoldoutInput,
  HoldoutInterface,
  HoldoutNextScheduledStatusUpdate,
  HOLDOUT_API_EXPERIMENT_UPDATE_FIELDS,
  HOLDOUT_API_TARGETING_UPDATE_FIELDS,
  HOLDOUT_API_UPDATE_FIELDS,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import {
  Changeset,
  ExperimentInterface,
  ExperimentPhase,
} from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { DataSourceInterface } from "shared/types/datasource";
import { resolveOwnerToUserId } from "back-end/src/services/owner";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  createExperiment,
  deleteExperimentByIdForOrganization,
  getExperimentsByIds,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  getFeaturesByIds,
  removeHoldoutFromFeature,
} from "back-end/src/models/FeatureModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { isHoldoutAvailableForProject } from "back-end/src/services/holdout-availability";
import { getAffectedSDKPayloadKeys } from "back-end/src/util/holdouts";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { BadRequestError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import {
  getChangesToStartExperiment,
  validateExperimentData,
  validateVariationIds,
} from "back-end/src/services/experiments";
import { assertRegisteredAttributes } from "back-end/src/services/attributes";

export function assertCanRunHoldoutEnvironments(
  context: ReqContext | ApiReqContext,
  {
    enabledEnvironments,
    projects,
  }: {
    enabledEnvironments: string[];
    projects: string[];
  },
): void {
  // Envs the org no longer has can't serve the holdout, so demanding run
  // permission on them would be a spurious denial.
  const orgEnvs = new Set(getEnvironmentIdsFromOrg(context.org));
  const envs = enabledEnvironments.filter((env) => orgEnvs.has(env));
  if (envs.length === 0) return;
  if (!context.permissions.canRunHoldout({ projects }, envs)) {
    context.permissions.throwPermissionError();
  }
}

/**
 * Reject env ids the org doesn't have. Ids already stored on the holdout (pass
 * `existingEnvironments`) are tolerated, so a client echoing back settings that
 * predate an environment deletion isn't blocked.
 */
export function assertValidHoldoutEnvironments(
  context: ReqContext | ApiReqContext,
  environments: Record<string, unknown> | undefined | null,
  existingEnvironments?: Record<string, unknown>,
): void {
  if (!environments) return;
  const orgEnvs = new Set(getEnvironmentIdsFromOrg(context.org));
  const existing = new Set(
    existingEnvironments ? Object.keys(existingEnvironments) : [],
  );
  const invalid = Object.keys(environments).filter(
    (env) => !orgEnvs.has(env) && !existing.has(env),
  );
  if (invalid.length) {
    throw new BadRequestError(
      `Invalid environment${invalid.length > 1 ? "s" : ""}: ${invalid.join(
        ", ",
      )}`,
    );
  }
}

/**
 * Shared by the REST and UI update paths so the two cannot drift. Update
 * permission is always required, on the destination scope when the Holdout is
 * moving. A change additionally needs run permission when it authorizes a
 * deployment: schedule changes at any stage, since they hand the agenda job
 * authority to transition the Holdout later; targeting, environment and archive
 * changes only while it is running, since that is when they reach the payload.
 */
export function assertCanUpdateHoldout(
  context: ReqContext | ApiReqContext,
  {
    holdout,
    updatedProjects,
    requestedEnabledEnvironments,
    isTargetingChange,
    isScheduleChange,
    isArchiveChange,
    isRunning,
  }: {
    holdout: HoldoutInterface;
    updatedProjects?: string[];
    requestedEnabledEnvironments?: string[];
    isTargetingChange: boolean;
    isScheduleChange: boolean;
    isArchiveChange: boolean;
    isRunning: boolean;
  },
): void {
  if (
    !context.permissions.canUpdateHoldout(holdout, {
      projects: updatedProjects ?? holdout.projects,
    })
  ) {
    context.permissions.throwPermissionError();
  }

  const isEnvironmentChange = requestedEnabledEnvironments !== undefined;
  const requiresRunPermission =
    isScheduleChange ||
    (isRunning &&
      (isTargetingChange || isEnvironmentChange || isArchiveChange));
  if (!requiresRunPermission) return;

  const enabledEnvironments = Array.from(
    new Set([
      ...getEnabledHoldoutEnvironments(holdout.environmentSettings),
      ...(requestedEnabledEnvironments ?? []),
    ]),
  );
  assertCanRunHoldoutEnvironments(context, {
    enabledEnvironments,
    projects: updatedProjects ?? holdout.projects,
  });
}

/**
 * Shared by the model's `beforeUpdate` hook and the REST create handler, which
 * runs it before writing so a rejected schedule can't leave a half-created
 * Holdout behind.
 */
export function assertValidHoldoutSchedule({
  schedule,
  currentStage,
  analysisStartDate,
}: {
  schedule:
    | {
        startAt?: string | Date | null;
        startAnalysisPeriodAt?: string | Date | null;
        stopAt?: string | Date | null;
      }
    | null
    | undefined;
  currentStage: HoldoutStage;
  analysisStartDate?: Date | null;
}): void {
  if (!schedule) return;

  const startAt = schedule.startAt ? getValidDate(schedule.startAt) : undefined;
  const startAnalysisPeriodAt = schedule.startAnalysisPeriodAt
    ? getValidDate(schedule.startAnalysisPeriodAt)
    : undefined;
  const stopAt = schedule.stopAt ? getValidDate(schedule.stopAt) : undefined;

  const now = new Date();

  if (startAt && currentStage === "draft" && startAt < now) {
    throw new BadRequestError("Scheduled start date cannot be in the past");
  }
  if (
    startAnalysisPeriodAt &&
    currentStage === "running" &&
    startAnalysisPeriodAt < now
  ) {
    throw new BadRequestError(
      "Scheduled analysis start date cannot be in the past",
    );
  }
  if (stopAt && currentStage !== "stopped" && stopAt < now) {
    throw new BadRequestError("Scheduled stop date cannot be in the past");
  }

  if (
    currentStage === "draft" &&
    stopAt &&
    (!startAt || !startAnalysisPeriodAt)
  ) {
    throw new BadRequestError(
      "To set a stop date, you must also set a start date and an analysis start date",
    );
  }
  if (currentStage === "draft" && startAnalysisPeriodAt && !startAt) {
    throw new BadRequestError(
      "To set an analysis start date, you must first set a start date",
    );
  }

  if (currentStage === "running" && stopAt && !startAnalysisPeriodAt) {
    throw new BadRequestError(
      "To set a stop date, you must first set an analysis start date",
    );
  }

  const dateError =
    (startAt &&
      startAnalysisPeriodAt &&
      currentStage === "draft" &&
      startAt > startAnalysisPeriodAt) ||
    (startAt && stopAt && currentStage === "draft" && startAt > stopAt) ||
    (startAnalysisPeriodAt &&
      stopAt &&
      !analysisStartDate &&
      startAnalysisPeriodAt > stopAt);
  if (dateError) {
    throw new BadRequestError("Scheduled dates must be consecutive");
  }
}

export async function canLinkExperimentToHoldoutFromFeatures(
  context: ReqContext | ApiReqContext,
  holdoutId: string,
  featureIds: string[],
): Promise<boolean> {
  if (!featureIds.length) return false;
  const features = await getFeaturesByIds(context, featureIds);
  // Lets the caller reach a Holdout outside their project scope, on the evidence
  // that they already hold authority over a Feature Flag inside it. Either half
  // of that authority counts — drafting or landing — since both mean they are
  // legitimately working on a flag the Holdout already contains.
  const orgEnvs = getEnvironmentIdsFromOrg(context.org);
  return features.some(
    (feature) =>
      feature.holdout?.id === holdoutId &&
      (context.permissions.canEditFeatureDrafts(feature) ||
        context.permissions.canPublishFeature(
          feature,
          Array.from(getEnabledEnvironments(feature, orgEnvs)),
        )),
  );
}

// Holdout-compatibility gate for adding an experiment-ref rule to a feature.
//
// `effectiveHoldout` is the holdout the rule will publish under, resolved by the
// caller (the live `feature.holdout`, or the target revision's holdout when
// posting to a different draft). Validation only; the publish re-checks these
// against live state.
//
// Incompatibilities throw via `makeError`, so REST handlers can surface a 400
// (`BadRequestError`) while controllers get a plain `Error` (the default).
export async function resolveHoldoutExperimentToLink({
  context,
  feature,
  experiment,
  effectiveHoldout,
  makeError = (message: string) => new Error(message),
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  experiment: ExperimentInterface;
  effectiveHoldout: { id: string } | null | undefined;
  makeError?: (message: string) => Error;
}): Promise<void> {
  if (effectiveHoldout?.id) {
    // Experiment already belongs to a different holdout — refuse the mismatch.
    if (experiment.holdoutId && experiment.holdoutId !== effectiveHoldout.id) {
      const featureHoldout = await context.models.holdout.getById(
        effectiveHoldout.id,
      );
      const expHoldout = await context.models.holdout.getById(
        experiment.holdoutId,
      );
      throw makeError(
        `Cannot add experiment rule: experiment belongs to holdout "${expHoldout?.name || experiment.holdoutId}" but this feature flag uses holdout "${featureHoldout?.name || effectiveHoldout.id}".`,
      );
    }

    // Not yet linked: validate it can join the holdout, then signal the caller
    // to perform the link.
    if (!experiment.holdoutId) {
      // Re-checked at publish, which is what actually gates the linkage.
      const holdout = await context.models.holdout.getByIdForLinkage(
        effectiveHoldout.id,
      );
      if (
        holdout &&
        !isHoldoutAvailableForProject(holdout, experiment.project)
      ) {
        throw makeError(
          `Cannot add experiment rule: holdout "${holdout.name}" is not available in the experiment's Project.`,
        );
      }
      if (experiment.status !== "draft") {
        throw makeError(
          `Cannot add experiment rule: this feature flag uses a holdout, so the experiment must be in "draft" status (currently "${experiment.status ?? "unknown"}").`,
        );
      }
      // Self-links never count: linkedFeatures is deliberately sticky (see
      // syncFeatureExperimentLinkages), so a discarded draft on this same feature
      // leaves one behind, and counting it blocked re-adding the rule.
      const expHasLinkedChanges =
        (experiment.linkedFeatures?.some((fid) => fid !== feature.id) ??
          false) ||
        experiment.hasURLRedirects ||
        experiment.hasVisualChangesets;
      if (expHasLinkedChanges) {
        throw makeError(
          `Cannot add experiment rule: this feature flag uses a holdout, but the experiment already has linked Feature Flags, URL redirects, or visual changesets. Unlink them first.`,
        );
      }
      return;
    }

    // Already linked to this same holdout: nothing to do.
    return;
  }

  // Feature is not in a holdout, but the experiment already belongs to one.
  if (experiment.holdoutId) {
    const expHoldout = await context.models.holdout.getById(
      experiment.holdoutId,
    );
    throw makeError(
      `Cannot add experiment rule: this experiment belongs to holdout "${expHoldout?.name || experiment.holdoutId}", but this feature flag is not in a holdout. Add the feature flag to that holdout first, then add the experiment.`,
    );
  }
}

export function assertValidAssignmentQuery(
  datasource: DataSourceInterface | null,
  assignmentQueryId: string | undefined,
): void {
  if (!assignmentQueryId) return;
  const exposureQuery = datasource?.settings?.queries?.exposure?.find(
    (q) => q.id === assignmentQueryId,
  );
  if (!exposureQuery) {
    throw new Error("Invalid assignment query: " + assignmentQueryId);
  }
}

export async function createHoldoutWithExperiment(
  context: ReqContext | ApiReqContext,
  data: CreateHoldoutInput,
): Promise<{
  holdout: HoldoutInterface;
  experiment: ExperimentInterface;
  datasource: DataSourceInterface | null;
  metricIds: string[];
}> {
  const { org, userId } = context;

  const { metricIds, datasource } = await validateExperimentData(context, {
    datasource: data.datasourceId,
    goalMetrics: data.goalMetrics,
    secondaryMetrics: data.secondaryMetrics,
  });

  assertValidAssignmentQuery(datasource, data.assignmentQueryId);

  const conditionResult = validateCondition(data.targetingCondition);
  if (!conditionResult.success) {
    throw new Error(`Invalid targeting condition: ${conditionResult.error}`);
  }

  if (data.projects && data.projects.length > 0) {
    await context.models.projects.ensureProjectsExist(data.projects);
  }

  assertRegisteredAttributes(
    context,
    { hashAttribute: data.hashAttribute, condition: data.targetingCondition },
    "holdout",
    undefined,
    data.projects ?? [],
  );

  assertValidHoldoutEnvironments(context, data.environmentSettings);

  const variations = [
    {
      name: "Holdout",
      description: "",
      key: "0",
      screenshots: [],
      id: generateVariationId(),
    },
    {
      name: "Treatment",
      description: "",
      key: "1",
      screenshots: [],
      id: generateVariationId(),
    },
  ];

  const obj: Omit<ExperimentInterface, "id" | "uid"> = {
    organization: org.id,
    archived: false,
    hashAttribute: data.hashAttribute || "id",
    fallbackAttribute: "",
    hashVersion: 2,
    disableStickyBucketing: true,
    autoSnapshots: true,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    project: "",
    owner: data.owner || userId,
    trackingKey: `holdout-${uuidv4()}`,
    datasource: data.datasourceId || "",
    exposureQueryId: data.assignmentQueryId || "",
    userIdType: "anonymous",
    name: data.name,
    phases: [
      {
        name: "Holdout",
        reason: "",
        dateStarted: new Date(),
        coverage: holdoutSizeToCoverage(
          data.holdoutSize ?? DEFAULT_HOLDOUT_SIZE,
        ),
        condition: data.targetingCondition ?? "",
        savedGroups: data.savedGroups,
        variationWeights: [0.5, 0.5],
        variations: variations.map((v) => ({
          id: v.id,
          status: "active" as const,
        })),
      },
    ],
    tags: data.tags || [],
    description: data.description || "",
    hypothesis: "",
    goalMetrics: data.goalMetrics || [],
    secondaryMetrics: data.secondaryMetrics || [],
    guardrailMetrics: [],
    activationMetric: "",
    metricOverrides: [],
    segment: "",
    queryFilter: "",
    skipPartialData: false,
    attributionModel: "firstExposure",
    variations,
    implementation: "code",
    status: "draft",
    results: undefined,
    analysis: "",
    releasedVariationId: "",
    excludeFromPayload: true,
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    sequentialTestingEnabled: false,
    sequentialTestingTuningParameter:
      org?.settings?.sequentialTestingTuningParameter ??
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
    regressionAdjustmentEnabled: false,
    statsEngine: data.statsEngine,
    type: "holdout",
    customFields: data.customFields,
    shareLevel: "organization",
    decisionFrameworkSettings: {},
  };

  validateVariationIds(obj.variations);

  const experiment = await createExperiment({ data: obj, context });

  const holdout = await context.models.holdout.create({
    experimentId: experiment.id,
    projects: data.projects || [],
    name: experiment.name,
    skipAsDefaultHoldout: data.skipAsDefaultHoldout,
    environmentSettings: data.environmentSettings || {},
    linkedFeatures: {},
    linkedExperiments: {},
  });

  return { holdout, experiment, datasource, metricIds };
}

/**
 * The two documents share no transaction, so a failed holdout write leaves the
 * experiment ahead of it. Returns whether the restore landed; a failure is
 * logged for manual reconciliation rather than masking the caller's error.
 */
async function rollbackExperimentAfterHoldoutFailure(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  revertChanges: Partial<ExperimentInterface>,
  logContext: string,
): Promise<boolean> {
  try {
    await updateExperiment({
      context,
      experiment,
      changes: revertChanges,
    });
    return true;
  } catch (revertError) {
    logger.error(
      revertError,
      `Failed to roll back experiment "${experiment.id}" ${logContext}; the holdout and experiment are now inconsistent and need reconciling by hand`,
    );
    return false;
  }
}

/**
 * Pass `previousHoldout` when a write moves the holdout's environment or project
 * footprint, so keys for both the old and the new one are invalidated. Callers
 * decide whether a change reaches the payload at all — only running holdouts serve.
 */
export function refreshHoldoutPayload(
  context: ReqContext | ApiReqContext,
  {
    holdout,
    previousHoldout,
    event,
  }: {
    holdout: HoldoutInterface;
    previousHoldout?: HoldoutInterface;
    event: string;
  },
): void {
  const orgEnvs = getEnvironmentIdsFromOrg(context.org);
  const seen = new Set<string>();
  const payloadKeys = [holdout, ...(previousHoldout ? [previousHoldout] : [])]
    .flatMap((h) => getAffectedSDKPayloadKeys(h, orgEnvs))
    .filter((key) => {
      const s = JSON.stringify(key);
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    });
  queueSDKPayloadRefresh({
    context,
    payloadKeys,
    auditContext: { event, model: "holdout", id: holdout.id },
  });
}

/** Applies a REST update body across both documents. Callers gate permissions. */
export async function updateHoldoutWithExperiment(
  context: ReqContext | ApiReqContext,
  {
    holdout,
    experiment,
    body,
  }: {
    holdout: HoldoutInterface;
    experiment: ExperimentInterface;
    body: ApiUpdateHoldoutBody;
  },
): Promise<{ holdout: HoldoutInterface; experiment: ExperimentInterface }> {
  assertValidHoldoutEnvironments(
    context,
    body.environments,
    holdout.environmentSettings,
  );

  if (
    body.projects !== undefined &&
    !isEqual(body.projects, holdout.projects)
  ) {
    if (body.projects.length) {
      await context.models.projects.ensureProjectsExist(body.projects);
    }
    // Narrowing the project scope must not strand linked entities
    await assertHoldoutScopeCoversLinked(context, holdout, body.projects);
  }

  const experimentChanges: Partial<ExperimentInterface> = {};

  const isTargetingChange = HOLDOUT_API_TARGETING_UPDATE_FIELDS.some(
    (field) => body[field] !== undefined,
  );
  if (isTargetingChange) {
    const phases = [...experiment.phases];
    if (!phases.length) {
      throw new Error("Holdout does not have a phase to target");
    }

    // Catch a malformed condition here rather than at bucketing time.
    // validateCondition treats undefined and "{}" as valid.
    if (body.targetingCondition !== undefined) {
      const conditionResult = validateCondition(body.targetingCondition);
      if (!conditionResult.success) {
        throw new Error(
          `Invalid targeting condition: ${conditionResult.error}`,
        );
      }
    }

    // Passing the persisted values as `existingParts` limits this to attributes
    // the request actually changes, so a Holdout that predates the org's
    // registration setting stays editable.
    assertRegisteredAttributes(
      context,
      {
        hashAttribute: body.hashAttribute,
        condition: body.targetingCondition,
      },
      "holdout",
      {
        hashAttribute: experiment.hashAttribute || "id",
        condition: getActivePhase(experiment)?.condition,
      },
      body.projects ?? holdout.projects,
    );

    // The analysis-period phase must carry the same targeting as the payload
    // phase, so mirror the change across every phase, not just the last.
    const targetingCoverage =
      body.holdoutSize === undefined
        ? undefined
        : holdoutSizeToCoverage(body.holdoutSize);

    experimentChanges.phases = phases.map((phase) => ({
      ...phase,
      condition: body.targetingCondition ?? phase.condition,
      savedGroups: body.savedGroupTargeting ?? phase.savedGroups,
      coverage: targetingCoverage ?? phase.coverage,
    }));
    if (body.hashAttribute !== undefined) {
      experimentChanges.hashAttribute = body.hashAttribute;
    }
  }

  for (const field of HOLDOUT_API_EXPERIMENT_UPDATE_FIELDS) {
    if (body[field] !== undefined) {
      (experimentChanges as Record<string, unknown>)[field] = body[field];
    }
  }
  if (body.owner !== undefined) {
    experimentChanges.owner = await resolveOwnerToUserId(body.owner, context);
  }
  // Validate against the post-update values, so a metric or exposure query left
  // stale by a datasource-only change is rejected here, not at query time.
  if (
    body.datasourceId !== undefined ||
    body.assignmentQueryId !== undefined ||
    body.goalMetrics !== undefined ||
    body.secondaryMetrics !== undefined
  ) {
    const { datasource } = await validateExperimentData(context, {
      datasource: body.datasourceId ?? experiment.datasource,
      goalMetrics: body.goalMetrics ?? experiment.goalMetrics,
      secondaryMetrics: body.secondaryMetrics ?? experiment.secondaryMetrics,
    });

    assertValidAssignmentQuery(
      datasource,
      body.assignmentQueryId ?? experiment.exposureQueryId,
    );

    if (body.datasourceId !== undefined) {
      experimentChanges.datasource = body.datasourceId;
    }
    if (body.assignmentQueryId !== undefined) {
      experimentChanges.exposureQueryId = body.assignmentQueryId;
    }
  }
  // The name is stored on both documents and must not drift.
  if (body.name !== undefined) {
    experimentChanges.name = body.name;
  }

  const holdoutUpdates: UpdateProps<HoldoutInterface> = {};
  for (const field of HOLDOUT_API_UPDATE_FIELDS) {
    if (body[field] !== undefined) {
      (holdoutUpdates as Record<string, unknown>)[field] = body[field];
    }
  }
  if (body.name !== undefined) {
    holdoutUpdates.name = body.name;
  }
  if (body.environments !== undefined) {
    holdoutUpdates.environmentSettings = Object.fromEntries(
      Object.entries(body.environments).map(([id, settings]) => [
        id,
        { enabled: settings.enabled },
      ]),
    );
  }
  if (body.statusUpdateSchedule !== undefined) {
    Object.assign(
      holdoutUpdates,
      normalizeHoldoutScheduleUpdates({
        holdout,
        experiment,
        scheduleInput: body.statusUpdateSchedule,
      }),
    );
  }

  // The experiment is written first and there is no cross-document transaction,
  // so snapshot what changed and roll it back if the holdout write fails
  // (mirrors `setHoldoutStage`).
  const originalExperimentValues: Partial<ExperimentInterface> = {};
  for (const key of Object.keys(experimentChanges)) {
    (originalExperimentValues as Record<string, unknown>)[key] = (
      experiment as Record<string, unknown>
    )[key];
  }

  const affectsPayload =
    experiment.status === "running" &&
    (isTargetingChange ||
      body.environments !== undefined ||
      body.projects !== undefined ||
      body.archived !== undefined);
  const refreshPayload = (finalHoldout: HoldoutInterface) => {
    if (!affectsPayload) return;
    refreshHoldoutPayload(context, {
      holdout: finalHoldout,
      previousHoldout: holdout,
      event: "Holdout updated",
    });
  };

  const experimentChanged = Object.keys(experimentChanges).length > 0;
  if (experimentChanged) {
    experiment = await updateExperiment({
      context,
      experiment,
      changes: experimentChanges,
    });
  }

  if (!Object.keys(holdoutUpdates).length) {
    refreshPayload(holdout);
    return { holdout, experiment };
  }

  try {
    const updatedHoldout = await context.models.holdout.update(
      holdout,
      holdoutUpdates,
    );
    refreshPayload(updatedHoldout);
    return { holdout: updatedHoldout, experiment };
  } catch (e) {
    if (experimentChanged) {
      const reverted = await rollbackExperimentAfterHoldoutFailure(
        context,
        experiment,
        originalExperimentValues,
        "after holdout update failed",
      );
      // See `commitTransition`: a failed revert leaves the experiment changed,
      // so the cache needs rebuilding even though the write as a whole failed.
      if (!reverted) refreshPayload(holdout);
    }
    throw e;
  }
}

export function normalizeHoldoutScheduleUpdates({
  holdout,
  experiment,
  scheduleInput,
}: {
  holdout: Pick<
    HoldoutInterface,
    "statusUpdateSchedule" | "nextScheduledStatusUpdate" | "analysisStartDate"
  >;
  experiment: Pick<ExperimentInterface, "status">;
  scheduleInput:
    | {
        startAt?: string | Date | null;
        startAnalysisPeriodAt?: string | Date | null;
        stopAt?: string | Date | null;
      }
    | null
    | undefined;
}): {
  statusUpdateSchedule: HoldoutInterface["statusUpdateSchedule"];
  nextScheduledStatusUpdate: HoldoutInterface["nextScheduledStatusUpdate"];
} {
  if (scheduleInput === null) {
    return { statusUpdateSchedule: null, nextScheduledStatusUpdate: null };
  }
  if (scheduleInput === undefined) {
    return {
      statusUpdateSchedule: holdout.statusUpdateSchedule,
      nextScheduledStatusUpdate: holdout.nextScheduledStatusUpdate ?? null,
    };
  }

  const existing = holdout.statusUpdateSchedule ?? {};
  const statusUpdateSchedule = {
    ...existing,
    ...(scheduleInput.startAt !== undefined && {
      startAt: scheduleInput.startAt
        ? getValidDate(scheduleInput.startAt)
        : undefined,
    }),
    ...(scheduleInput.startAnalysisPeriodAt !== undefined && {
      startAnalysisPeriodAt: scheduleInput.startAnalysisPeriodAt
        ? getValidDate(scheduleInput.startAnalysisPeriodAt)
        : undefined,
    }),
    ...(scheduleInput.stopAt !== undefined && {
      stopAt: scheduleInput.stopAt
        ? getValidDate(scheduleInput.stopAt)
        : undefined,
    }),
  };

  const potentialUpdates: Array<{
    date: Date;
    type: HoldoutNextScheduledStatusUpdate["type"];
  }> = [];
  const currentStage = getHoldoutStage(holdout, experiment);

  if (statusUpdateSchedule.startAt && currentStage === "draft") {
    potentialUpdates.push({
      date: statusUpdateSchedule.startAt,
      type: "start",
    });
  }
  if (
    statusUpdateSchedule.startAnalysisPeriodAt &&
    currentStage === "running"
  ) {
    potentialUpdates.push({
      date: statusUpdateSchedule.startAnalysisPeriodAt,
      type: "startAnalysisPeriod",
    });
  }
  if (statusUpdateSchedule.stopAt && currentStage !== "stopped") {
    potentialUpdates.push({
      date: statusUpdateSchedule.stopAt,
      type: "stop",
    });
  }

  const now = new Date();
  const futureUpdates = potentialUpdates.filter((update) => update.date > now);
  if (!futureUpdates.length) {
    return { statusUpdateSchedule, nextScheduledStatusUpdate: null };
  }

  const nextUpdate = futureUpdates.reduce((earliest, current) =>
    current.date < earliest.date ? current : earliest,
  );
  return {
    statusUpdateSchedule,
    nextScheduledStatusUpdate: {
      type: nextUpdate.type,
      date: nextUpdate.date,
    },
  };
}

export function getNextScheduledStatusUpdateForStage(
  statusUpdateSchedule: HoldoutInterface["statusUpdateSchedule"],
  stage: HoldoutStage,
): HoldoutInterface["nextScheduledStatusUpdate"] {
  switch (stage) {
    case "running":
      return statusUpdateSchedule?.startAnalysisPeriodAt
        ? {
            type: "startAnalysisPeriod",
            date: statusUpdateSchedule.startAnalysisPeriodAt,
          }
        : null;
    case "analysis-period":
      return statusUpdateSchedule?.stopAt
        ? { type: "stop", date: statusUpdateSchedule.stopAt }
        : null;
    case "draft":
    case "stopped":
      return null;
    default:
      stage satisfies never;
      return null;
  }
}

export async function setHoldoutStage(
  context: ReqContext | ApiReqContext,
  {
    holdout,
    experiment,
    stage,
  }: {
    holdout: HoldoutInterface;
    experiment: ExperimentInterface;
    stage: HoldoutStage;
  },
): Promise<void> {
  const currentStage = getHoldoutStage(holdout, experiment);
  if (currentStage === stage) return;

  let phases = [...experiment.phases] as ExperimentPhase[];
  const changes: Changeset = {};

  // Snapshot before any branch below mutates them; `commitTransition` restores
  // these if the holdout write fails.
  const originalStatus = experiment.status;
  const originalPhases = structuredClone(experiment.phases);

  const refreshPayload = (event: string) =>
    refreshHoldoutPayload(context, { holdout, event });

  // Commits across both documents. A holdout failure rolls the experiment back
  // and rethrows, leaving the schedule pointer untouched so a retry re-selects
  // the still-due holdout.
  const commitTransition = async (
    event: string,
    holdoutChanges: UpdateProps<HoldoutInterface>,
  ) => {
    const updatedExperiment = await updateExperiment({
      context,
      experiment,
      changes,
    });
    try {
      await context.models.holdout.update(holdout, holdoutChanges);
    } catch (e) {
      const reverted = await rollbackExperimentAfterHoldoutFailure(
        context,
        updatedExperiment,
        { status: originalStatus, phases: originalPhases },
        `after holdout update failed during "${event}"`,
      );
      // Refresh either way. A landed revert rebuilds to what the cache already
      // has, but a failed one leaves the experiment write standing — and payload
      // eligibility reads experiment.status, so the cache is then wrong.
      refreshPayload(
        reverted ? `Reverted: ${event}` : `Rollback failed: ${event}`,
      );
      throw e;
    }
    refreshPayload(event);
  };

  switch (stage) {
    case "stopped": {
      if (phases[0]) {
        phases[0].dateEnded = new Date();
      }
      if (phases[1]) {
        phases[1].dateEnded = new Date();
      }
      Object.assign(changes, { phases, status: "stopped" });
      await commitTransition("Status changed to stopped", {
        nextScheduledStatusUpdate: getNextScheduledStatusUpdateForStage(
          holdout.statusUpdateSchedule,
          "stopped",
        ),
      });
      return;
    }

    case "draft": {
      if (!phases[0]) {
        throw new BadRequestError("Holdout does not have a phase");
      }
      phases[0].dateEnded = undefined;
      Object.assign(changes, { phases: [phases[0]], status: "draft" });
      await commitTransition("Status changed to draft", {
        analysisStartDate: undefined,
      });
      return;
    }

    case "running": {
      if (!phases[0]) {
        throw new BadRequestError("Holdout does not have a phase");
      }

      if (experiment.status === "draft") {
        Object.assign(
          changes,
          await getChangesToStartExperiment(context, experiment),
        );
        await commitTransition("Status changed to running", {
          analysisStartDate: undefined,
          nextScheduledStatusUpdate: getNextScheduledStatusUpdateForStage(
            holdout.statusUpdateSchedule,
            "running",
          ),
        });
        return;
      }

      phases[0] = { ...phases[0], dateEnded: undefined };
      if (phases[1]) {
        phases = [phases[0]];
      }
      Object.assign(changes, { phases, status: "running" });
      await commitTransition("Status changed to running", {
        analysisStartDate: undefined,
      });
      return;
    }

    case "analysis-period": {
      if (experiment.status === "draft") {
        throw new BadRequestError(
          "A Holdout must be running before it can enter its analysis period",
        );
      }
      if (!phases[0]) {
        throw new BadRequestError("Holdout does not have a phase");
      }
      const analysisStartDate = phases[1]?.lookbackStartDate ?? new Date();
      phases[1] = {
        ...phases[0],
        lookbackStartDate: analysisStartDate,
        dateEnded: undefined,
        name: "Analysis",
      };
      Object.assign(changes, { phases, status: "running" });
      await commitTransition("Status changed to analysis period", {
        analysisStartDate,
        nextScheduledStatusUpdate: getNextScheduledStatusUpdateForStage(
          holdout.statusUpdateSchedule,
          "analysis-period",
        ),
      });
      return;
    }
    default: {
      stage satisfies never;
    }
  }
}

/**
 * Callers are responsible for experiment-level permission checks; deleting the
 * holdout itself enforces canDeleteHoldout.
 */
export async function deleteHoldoutAndExperiment(
  context: ReqContext,
  holdout: HoldoutInterface,
  experiment: ExperimentInterface | null,
): Promise<void> {
  if (experiment) {
    await deleteExperimentByIdForOrganization(context, experiment);
  }

  // Remove holdout links from linked features and experiments
  const linkedFeatureIds = Object.keys(holdout.linkedFeatures);
  const linkedExperimentIds = Object.keys(holdout.linkedExperiments);
  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);
  const linkedExperiments = await getExperimentsByIds(
    context,
    linkedExperimentIds,
  );

  await Promise.all(
    linkedFeatures.map((f) => removeHoldoutFromFeature(context, f)),
  );
  await Promise.all(
    linkedExperiments.map((e) =>
      updateExperiment({
        context,
        experiment: e,
        changes: { holdoutId: "" },
      }),
    ),
  );

  await context.models.holdout.delete(holdout);

  refreshHoldoutPayload(context, { holdout, event: "deleted" });
}

// Mirror of `getHoldoutAvailableForProject`, applied from the Holdout side:
// narrowing a Holdout's Projects must not strand entities that are already
// linked from outside the new scope. Without this, the same invalid pairing the
// feature/experiment side refuses can be created by editing the Holdout, and a
// project-scoped SDK Connection then drops the Holdout from its payload while
// the Feature Flag still shows the rule.
export async function assertHoldoutScopeCoversLinked(
  context: ReqContext | ApiReqContext,
  holdout: HoldoutInterface,
  projects: string[],
): Promise<void> {
  // No Projects means every Project, so nothing can fall outside.
  if (!projects.length) return;

  const covered = new Set(projects);
  const featureIds = Object.keys(holdout.linkedFeatures ?? {});
  const experimentIds = Object.keys(holdout.linkedExperiments ?? {});
  if (!featureIds.length && !experimentIds.length) return;

  const stranded: string[] = [];

  if (featureIds.length) {
    const features = await getFeaturesByIds(context, featureIds);
    for (const feature of features) {
      if (!covered.has(feature.project ?? "")) {
        stranded.push(`Feature Flag "${feature.id}"`);
      }
    }
  }

  if (experimentIds.length) {
    const experiments = await getExperimentsByIds(context, experimentIds);
    for (const experiment of experiments) {
      if (!covered.has(experiment.project ?? "")) {
        stranded.push(`Experiment "${experiment.name}"`);
      }
    }
  }

  if (stranded.length) {
    throw new BadRequestError(
      `${stranded.join(", ")} ${stranded.length > 1 ? "are" : "is"} linked to this Holdout but ${stranded.length > 1 ? "are" : "is"} not in the selected Projects. Remove ${stranded.length > 1 ? "them" : "it"} from the Holdout first.`,
    );
  }
}

export function isHoldoutExperiment(
  experiment: ExperimentInterface,
): experiment is ExperimentInterface & { type: "holdout" } {
  return experiment.type === "holdout";
}

export function getHoldoutLivePayloadChanges(
  experiment: ExperimentInterface & { type: "holdout" },
  coverage: number | undefined,
): { changesLivePayload: boolean; changedFields: string[] } {
  const payloadPhase = experiment.phases[0];
  const coverageChanged =
    coverage !== undefined && coverage !== payloadPhase?.coverage;
  return {
    changesLivePayload: coverageChanged,
    changedFields: coverageChanged ? ["coverage"] : [],
  };
}
