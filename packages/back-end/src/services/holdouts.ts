import { v4 as uuidv4 } from "uuid";
import { getValidDate } from "shared/dates";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import {
  generateVariationId,
  getHoldoutStage,
  HoldoutStage,
} from "shared/util";
import {
  HoldoutInterface,
  HoldoutNextScheduledStatusUpdate,
} from "shared/validators";
import {
  Changeset,
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  ExperimentPhase,
} from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { DataSourceInterface } from "shared/types/datasource";
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
import { BadRequestError, InternalServerError } from "back-end/src/util/errors";
import {
  getChangesToStartExperiment,
  validateExperimentData,
  validateVariationIds,
} from "back-end/src/services/experiments";

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

export async function createHoldoutWithExperiment(
  context: ReqContext | ApiReqContext,
  data: Partial<ExperimentInterfaceStringDates> & Partial<HoldoutInterface>,
): Promise<{
  holdout: HoldoutInterface;
  experiment: ExperimentInterface;
  datasource: DataSourceInterface | null;
  metricIds: string[];
}> {
  const { org, userId } = context;

  const { metricIds, datasource } = await validateExperimentData(context, data);

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
    hashAttribute: data.hashAttribute || "",
    fallbackAttribute: data.fallbackAttribute || "",
    hashVersion: 2,
    disableStickyBucketing: true,
    autoSnapshots: true,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    project: "",
    owner: data.owner || userId,
    trackingKey: `holdout-${uuidv4()}`,
    datasource: data.datasource || "",
    exposureQueryId: data.exposureQueryId || "",
    userIdType: data.userIdType || "anonymous",
    name: data.name || "",
    phases: data.phases
      ? data.phases.map(({ dateStarted, dateEnded, ...phase }) => {
          return {
            ...phase,
            dateStarted: dateStarted ? getValidDate(dateStarted) : new Date(),
            dateEnded: dateEnded ? getValidDate(dateEnded) : undefined,
          };
        })
      : [],
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
    // todo: revisit this logic for project level settings, as well as "override stats settings" toggle:
    sequentialTestingEnabled: false,
    sequentialTestingTuningParameter:
      data.sequentialTestingTuningParameter ??
      org?.settings?.sequentialTestingTuningParameter ??
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
    regressionAdjustmentEnabled: false,
    statsEngine: data.statsEngine,
    type: "holdout",
    customFields: data.customFields || undefined,
    shareLevel: data.shareLevel || "organization",
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

  if (!holdout) {
    throw new InternalServerError("Failed to create holdout");
  }

  return { holdout, experiment, datasource, metricIds };
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

  const refreshPayload = (event: string) =>
    queueSDKPayloadRefresh({
      context,
      payloadKeys: getAffectedSDKPayloadKeys(
        holdout,
        getEnvironmentIdsFromOrg(context.org),
      ),
      auditContext: {
        event,
        model: "holdout",
        id: holdout.id,
      },
    });

  switch (stage) {
    case "stopped": {
      if (phases[0]) {
        phases[0].dateEnded = new Date();
      }
      if (phases[1]) {
        phases[1].dateEnded = new Date();
      }
      Object.assign(changes, { phases, status: "stopped" });
      await updateExperiment({ context, experiment, changes });
      refreshPayload("Status changed to stopped");
      await context.models.holdout.update(holdout, {
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
      await updateExperiment({ context, experiment, changes });
      refreshPayload("Status changed to draft");
      await context.models.holdout.update(holdout, {
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
        await updateExperiment({ context, experiment, changes });
        refreshPayload("Status changed to running");
        await context.models.holdout.update(holdout, {
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
      await updateExperiment({ context, experiment, changes });
      refreshPayload("Status changed to running");
      await context.models.holdout.update(holdout, {
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
      await updateExperiment({ context, experiment, changes });
      refreshPayload("Status changed to analysis period");
      await context.models.holdout.update(holdout, {
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
 * Delete a holdout along with its underlying experiment, unlink it from its
 * linked features and experiments, and refresh affected SDK payloads. Callers
 * are responsible for experiment-level permission checks; deleting the holdout
 * itself enforces canDeleteHoldout.
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

  queueSDKPayloadRefresh({
    context,
    payloadKeys: getAffectedSDKPayloadKeys(
      holdout,
      getEnvironmentIdsFromOrg(context.org),
    ),
    auditContext: {
      event: "deleted",
      model: "holdout",
      id: holdout.id,
    },
  });
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
