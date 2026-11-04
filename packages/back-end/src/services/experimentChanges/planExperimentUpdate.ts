import { v4 as uuidv4 } from "uuid";
import { getValidDate } from "shared/dates";
import {
  experimentHasLinkedChanges,
  includeExperimentInPayload,
} from "shared/util";
import {
  experimentFieldValue,
  getAllMetricIdsFromExperiment,
  getTargetingDefaults,
  isPhaseField,
  onlyTrafficFields,
  sameFieldValue,
} from "shared/experiments";
import type {
  ExperimentChangesBody,
  ExperimentChangesFields,
} from "shared/validators";
import { getScopedSettings } from "shared/settings";
import {
  Changeset,
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  ExperimentPhase,
} from "shared/types/experiment";
import type { AuditInterfaceInput } from "shared/types/audit";
import { getMetricMap } from "back-end/src/models/MetricModel";
import {
  assertCanRunExperimentChanges,
  assertExperimentKeyFormat,
  assertValidExperimentPhases,
  determineNextBanditSchedule,
  getExperimentAttributeScopeProjects,
  normalizeStatusUpdateScheduleChanges,
  resetExperimentBanditSettings,
  syncVisualChangesetsAndUrlRedirectsForExperiment,
  validateVariationIds,
} from "back-end/src/services/experiments";
import {
  assertRegisteredAttributesScoped,
  lazyAttributeScope,
} from "back-end/src/services/attributes";
import { validateScheduleUpdate } from "back-end/src/services/experimentScheduling";
import { validateExperimentChange } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import {
  generateExperimentEmbeddings,
  getExperimentByTrackingKey,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getExperimentAssignmentQueryScope,
  resolveAssignmentQueryIdentifier,
} from "back-end/src/services/assignmentQuerySelection";
import { assumeUtc } from "back-end/src/util/dates";
import { assertExperimentPrecomputedUnitDimensionIdsAreValid } from "back-end/src/services/dimensions";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { ReqContext } from "back-end/types/request";
import { BadRequestError } from "back-end/src/util/errors";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import {
  shouldValidateCustomFieldsOnUpdate,
  validateCustomFieldsForSection,
} from "back-end/src/util/custom-fields";
import { getLivePayloadChanges } from "back-end/src/services/experimentLivePayload";
import { validateChangedPhaseReferences } from "back-end/src/api/features/validations";
import { getHoldoutAvailableForProject } from "back-end/src/services/holdout-availability";
import { assertValidExperimentPrerequisites } from "back-end/src/services/prerequisiteParents";

export type ExperimentUpdateInput = Partial<ExperimentInterfaceStringDates> &
  // The latest phase's targeting.
  Pick<
    ExperimentChangesFields,
    | "coverage"
    | "variationWeights"
    | "condition"
    | "savedGroups"
    | "prerequisites"
    | "namespace"
    | "seed"
  > & {
    currentPhase?: number;
    phaseStartDate?: string;
    phaseEndDate?: string;
    isVariationKeyReconciliation?: boolean;
  };

// Who a bandit is learning about, and how they're bucketed.
const BUCKETING_FIELDS = [
  "hashAttribute",
  "fallbackAttribute",
  "hashVersion",
  "disableStickyBucketing",
  "bucketVersion",
  "minBucketVersion",
];

export type ExperimentUpdatePlan = {
  changes: Changeset;
  holdout: { remove: string | null; add: string | null };
  tags: string[];
};

const UPDATABLE_KEYS: (keyof ExperimentInterface)[] = [
  "trackingKey",
  "owner",
  "datasource",
  "exposureQueryId",
  "exposureQueryIdentifierType",
  "userIdType",
  "hashAttribute",
  "fallbackAttribute",
  "attributeScopeAllProjects",
  "disableStickyBucketing",
  "hashVersion",
  "bucketVersion",
  "minBucketVersion",
  "name",
  "tags",
  "description",
  "hypothesis",
  "activationMetric",
  "segment",
  "queryFilter",
  "skipPartialData",
  "attributionModel",
  "goalMetrics",
  "secondaryMetrics",
  "guardrailMetrics",
  "metricOverrides",
  "lookbackOverride",
  "decisionFrameworkSettings",
  "variations",
  "status",
  "statusUpdateSchedule",
  "results",
  "analysis",
  "winner",
  "implementation",
  "autoAssign",
  "previewURL",
  "targetURLRegex",
  "releasedVariationId",
  "excludeFromPayload",
  "autoSnapshots",
  "disableAutoSnapshots",
  "project",
  "regressionAdjustmentEnabled",
  "postStratificationEnabled",
  "hasVisualChangesets",
  "hasURLRedirects",
  "sequentialTestingEnabled",
  "sequentialTestingTuningParameter",
  "statsEngine",
  "type",
  "banditStage",
  "banditScheduleValue",
  "banditScheduleUnit",
  "banditBurnInValue",
  "banditBurnInUnit",
  "banditConversionWindowValue",
  "banditConversionWindowUnit",
  "customFields",
  "shareLevel",
  "uid",
  "analysisSummary",
  "dismissedWarnings",
  "holdoutId",
  "defaultDashboardId",
  "customMetricSlices",
  "precomputedUnitDimensionIds",
];

const DEEP_COMPARED_KEYS = new Set<keyof ExperimentInterface>([
  "goalMetrics",
  "secondaryMetrics",
  "guardrailMetrics",
  "metricOverrides",
  "lookbackOverride",
  "variations",
  "statusUpdateSchedule",
  "customFields",
  "customMetricSlices",
  "precomputedUnitDimensionIds",
]);

// Every gate an experiment update must pass, with no writes; `applyExperimentUpdatePlan` performs them.
export async function planExperimentUpdate(
  context: ReqContext,
  experiment: ExperimentInterface,
  input: ExperimentUpdateInput,
  { release }: Pick<ExperimentChangesBody, "release"> = {},
): Promise<ExperimentUpdatePlan> {
  const { org } = context;
  const {
    phaseStartDate,
    phaseEndDate,
    currentPhase,
    isVariationKeyReconciliation,
    ...data
  } = input;

  if (!context.permissions.canUpdateExperiment(experiment, input)) {
    context.permissions.throwPermissionError();
  }

  const attributeScope = lazyAttributeScope(() =>
    getExperimentAttributeScopeProjects(context, {
      project: "project" in data ? data.project : experiment.project,
      linkedFeatures: experiment.linkedFeatures,
    }),
  );
  const latestPhase = experiment.phases[experiment.phases.length - 1];
  await assertRegisteredAttributesScoped(
    context,
    {
      hashAttribute: data.hashAttribute,
      fallbackAttribute: data.fallbackAttribute,
      condition: data.condition,
    },
    "experiment",
    {
      hashAttribute: experiment.hashAttribute,
      fallbackAttribute: experiment.fallbackAttribute,
      condition: latestPhase?.condition,
    },
    attributeScope,
  );
  if (
    data.condition !== undefined ||
    data.savedGroups !== undefined ||
    data.prerequisites !== undefined
  ) {
    await validateChangedPhaseReferences(
      [
        {
          condition: data.condition ?? latestPhase?.condition,
          savedGroups: data.savedGroups ?? latestPhase?.savedGroups,
          prerequisites: data.prerequisites ?? latestPhase?.prerequisites,
        },
      ],
      experiment.phases.slice(-1),
      context,
    );
    await assertValidExperimentPrerequisites(
      context,
      data.prerequisites,
      latestPhase?.prerequisites,
    );
  }
  // Match persisted phases by condition value, not index — reordered or
  // spliced phase lists must not re-validate grandfathered conditions.
  const persistedConditions = new Set(
    (experiment.phases ?? []).map((p) => p.condition),
  );
  await validateChangedPhaseReferences(
    data.phases ?? [],
    experiment.phases,
    context,
  );
  for (const phase of data.phases ?? []) {
    await assertRegisteredAttributesScoped(
      context,
      { condition: phase.condition },
      "experiment phase",
      {
        condition: persistedConditions.has(phase.condition)
          ? phase.condition
          : undefined,
      },
      attributeScope,
    );
  }

  // FIXME: We skip validation because project is updated in a different place than where
  // we define custom fields, and that would prevent the user from doing either update.
  // Ideally we validate custom fields every time, but we need to update our UI to support that.
  if (
    shouldValidateCustomFieldsOnUpdate({
      existingCustomFieldValues: experiment.customFields,
      updatedCustomFieldValues: data.customFields,
    })
  ) {
    await validateCustomFieldsForSection({
      customFieldValues: data.customFields,
      existingCustomFieldValues: experiment.customFields,
      customFieldsModel: context.models.customFields,
      section: "experiment",
      project: "project" in data ? data.project : experiment.project,
    });
  }

  const { settings } = getScopedSettings({
    organization: org,
    experiment,
  });

  let datasourceId: string = experiment.datasource;

  if (data.datasource) {
    datasourceId = data.datasource;
    const datasource = await getDataSourceById(context, data.datasource);
    if (!datasource) {
      throw new BadRequestError("Invalid datasource: " + data.datasource);
    }
  }
  const allMetricGroups = await context.models.metricGroups.getAll();
  const oldMetricIds = getAllMetricIdsFromExperiment(
    experiment,
    false,
    allMetricGroups,
  );
  const newMetricIds = getAllMetricIdsFromExperiment(
    data,
    false,
    allMetricGroups,
  ).filter((m) => !oldMetricIds.includes(m));

  const metricMap = await getMetricMap(context);

  const invalidMetricIds: string[] = [];

  if (newMetricIds.length) {
    for (let i = 0; i < newMetricIds.length; i++) {
      const metric = metricMap.get(newMetricIds[i]);
      if (metric) {
        if (datasourceId && metric.datasource !== datasourceId) {
          throw new BadRequestError(
            "Metrics must be tied to the same datasource as the experiment: " +
              newMetricIds[i],
          );
        }
      } else {
        const metricGroup = await context.models.metricGroups.getById(
          newMetricIds[i],
        );
        if (metricGroup) {
          if (metricGroup.datasource !== datasourceId) {
            throw new BadRequestError(
              "Metric group must be tied to the same datasource as the experiment: " +
                newMetricIds[i],
            );
          }
        } else {
          invalidMetricIds.push(newMetricIds[i]);
          // TODO: Commented out as a hotfix. Remove when issue #5316 is fixed.
          // throw new BadRequestError("Unknown metric: " + newMetricIds[i]);
        }
      }
    }

    // TODO: Added as a hotfix. Remove when issue #5316 is fixed.
    // Filter out invalid metric ids from the data
    if (invalidMetricIds.length) {
      data.goalMetrics = data.goalMetrics?.filter(
        (id) => !invalidMetricIds.includes(id),
      );
      data.secondaryMetrics = data.secondaryMetrics?.filter(
        (id) => !invalidMetricIds.includes(id),
      );
      data.guardrailMetrics = data.guardrailMetrics?.filter(
        (id) => !invalidMetricIds.includes(id),
      );
      if (
        data.activationMetric &&
        invalidMetricIds.includes(data.activationMetric)
      ) {
        data.activationMetric = "";
      }
    }
  }

  if (data.variations) {
    validateVariationIds(data.variations);
  }
  // One split per variation: a variation added or removed brings its own.
  const variationCount = (data.variations ?? experiment.variations).length;
  if (
    data.variationWeights
      ? data.variationWeights.length !== variationCount
      : variationCount !== experiment.variations.length
  ) {
    throw new BadRequestError(
      "Adding or removing a variation needs a traffic split with one weight per variation.",
    );
  }

  const { changesLivePayload, changedFields: changedPayloadFields } =
    getLivePayloadChanges(experiment, {
      variations: data.variations,
      // A release changes what's served on purpose.
      ...(!release && {
        coverage: data.coverage,
        variationWeights: data.variationWeights,
      }),
      isVariationKeyReconciliation,
    });
  if (experiment.status === "running" && changesLivePayload) {
    const linkedFeaturesForPayload = await getFeaturesByIds(
      context,
      experiment.linkedFeatures || [],
    );
    const inPayload = includeExperimentInPayload(
      experiment,
      linkedFeaturesForPayload,
    );
    if (inPayload) {
      throw new BadRequestError(
        `Cannot change: [${changedPayloadFields.join(", ")}] while the experiment is running and live in the SDK payload.`,
      );
    }
  }

  if (
    data.trackingKey !== undefined &&
    data.trackingKey !== experiment.trackingKey
  ) {
    await assertExperimentKeyFormat(
      context,
      data.trackingKey,
      data.datasource ?? experiment.datasource,
    );
  }

  if (
    data.trackingKey &&
    data.trackingKey !== experiment.trackingKey &&
    org.settings?.requireUniqueExperimentTrackingKeys
  ) {
    const existing = await getExperimentByTrackingKey(
      context,
      data.trackingKey,
    );
    if (existing) {
      throw new BadRequestError(
        `An experiment with tracking key "${data.trackingKey}" already exists. Your organization requires unique experiment tracking keys.`,
      );
    }
  }

  // Joining, changing or clearing ("") the holdout.
  const holdoutChanges =
    data.holdoutId !== undefined &&
    (data.holdoutId || "") !== (experiment.holdoutId || "");
  // TODO(holdouts): allow changing holdout if the experiment is not linked to a feature
  // in the live! feature revision
  if (
    holdoutChanges &&
    (experiment.status !== "draft" || experimentHasLinkedChanges(experiment))
  ) {
    throw new BadRequestError(
      "A holdout can only change while the experiment is a draft with nothing linked. Discard the holdout change, or set the status back to draft and remove its linked changes.",
    );
  }

  const addedHoldoutId =
    data.holdoutId && data.holdoutId !== experiment.holdoutId
      ? data.holdoutId
      : null;
  if (addedHoldoutId) {
    await getHoldoutAvailableForProject({
      context,
      holdoutId: addedHoldoutId,
      project: data.project ?? experiment.project,
    });
  } else if (data.project !== undefined && experiment.holdoutId) {
    await getHoldoutAvailableForProject({
      context,
      holdoutId: experiment.holdoutId,
      project: data.project,
    });
  }
  const holdout: ExperimentUpdatePlan["holdout"] = {
    remove:
      holdoutChanges && experiment.holdoutId ? experiment.holdoutId : null,
    add: addedHoldoutId,
  };

  if (data.defaultDashboardId) {
    const dashboard = await context.models.dashboards.getById(
      data.defaultDashboardId,
    );
    if (!dashboard) {
      throw new BadRequestError(
        "Invalid dashboard: " + data.defaultDashboardId,
      );
    }
  }

  let changes: Changeset = {};

  UPDATABLE_KEYS.forEach((key) => {
    if (!(key in data)) {
      return;
    }

    const hasChanges = DEEP_COMPARED_KEYS.has(key)
      ? JSON.stringify(data[key]) !== JSON.stringify(experiment[key])
      : data[key] !== experiment[key];

    if (hasChanges) {
      Object.assign(changes, { [key]: data[key] });
    }
  });

  // A start runs its checklist and publishes linked drafts; a field write
  // would skip both.
  if (experiment.status === "draft" && changes.status === "running") {
    throw new BadRequestError(
      "Start this experiment instead of setting its status to running.",
    );
  }

  normalizeStatusUpdateScheduleChanges(experiment, changes, context.armer);

  // Same validation as PUT /schedule, against the stored schedule and the
  // post-update variations/metrics.
  if (data.statusUpdateSchedule) {
    validateScheduleUpdate({
      context,
      experimentType: data.type ?? experiment.type ?? "standard",
      status: experiment.status,
      archived: !!experiment.archived,
      phaseStart: experiment.phases[experiment.phases.length - 1]?.dateStarted,
      existingSchedule: experiment.statusUpdateSchedule,
      variations: changes.variations ?? experiment.variations,
      goalMetrics: changes.goalMetrics ?? experiment.goalMetrics,
      incoming: data.statusUpdateSchedule,
    });
  }

  if (changes.lookbackOverride?.type === "date") {
    changes.lookbackOverride = {
      type: "date",
      value: getValidDate(changes.lookbackOverride.value),
    };
  }

  const resolvedSelection = await resolveAssignmentQueryIdentifier(context, {
    previous: {
      datasource: experiment.datasource ?? "",
      exposureQueryId: experiment.exposureQueryId,
      identifierType: experiment.exposureQueryIdentifierType,
    },
    next: {
      datasource: changes.datasource ?? experiment.datasource ?? "",
      exposureQueryId: changes.exposureQueryId ?? experiment.exposureQueryId,
      // Read from the body, not `changes`: the diff drops an identifier equal
      // to the stored one, but on a newly chosen query it's still an explicit
      // selection.
      identifierType: data.exposureQueryIdentifierType,
    },
    onOmitted: "defaultToFirst",
    // A newly chosen query must fit the experiment's project after this edit.
    scope: () =>
      getExperimentAssignmentQueryScope(
        context,
        experiment,
        changes.project ?? experiment.project ?? "",
      ),
  });
  // Also overrides an echoed identifier on an unchanged selection, so an
  // implicit experiment stays implicit.
  if (resolvedSelection.changed || "exposureQueryIdentifierType" in changes) {
    changes.exposureQueryIdentifierType = resolvedSelection.identifierType;
  }

  const shouldValidatePrecomputedUnitDimensionIds =
    changes.precomputedUnitDimensionIds !== undefined ||
    changes.datasource !== undefined ||
    changes.exposureQueryId !== undefined ||
    changes.exposureQueryIdentifierType !== undefined;
  if (shouldValidatePrecomputedUnitDimensionIds) {
    const effectivePrecomputedUnitDimensionIds =
      changes.precomputedUnitDimensionIds ??
      experiment.precomputedUnitDimensionIds ??
      [];
    const effectiveDatasourceId =
      changes.datasource ?? experiment.datasource ?? "";
    const effectiveExposureQueryId =
      changes.exposureQueryId ?? experiment.exposureQueryId;
    const effectiveExposureQueryIdentifierType =
      "exposureQueryIdentifierType" in changes
        ? changes.exposureQueryIdentifierType
        : experiment.exposureQueryIdentifierType;
    if (effectivePrecomputedUnitDimensionIds.length > 0) {
      const effectiveDatasource = effectiveDatasourceId
        ? await getDataSourceById(context, effectiveDatasourceId)
        : null;
      await assertExperimentPrecomputedUnitDimensionIdsAreValid({
        context,
        datasource: effectiveDatasource,
        exposureQueryId: effectiveExposureQueryId,
        exposureQueryIdentifierType: effectiveExposureQueryIdentifierType,
        dimensionIds: effectivePrecomputedUnitDimensionIds,
      });
    }
  }

  const effectiveAttrModel =
    changes.attributionModel ?? experiment.attributionModel;
  const effectiveLookback =
    "lookbackOverride" in changes
      ? changes.lookbackOverride
      : experiment.lookbackOverride;
  if (effectiveAttrModel === "lookbackOverride" && !effectiveLookback) {
    throw new BadRequestError(
      "lookbackOverride is required when attributionModel is 'lookbackOverride'",
    );
  }

  // If changing phase start/end dates (from "Configure Analysis" modal)
  if (
    experiment.status !== "draft" &&
    currentPhase !== undefined &&
    experiment.phases?.[currentPhase] &&
    (phaseStartDate || phaseEndDate)
  ) {
    const phases = [...experiment.phases];
    const phaseClone = { ...phases[currentPhase] };
    phases[currentPhase] = phaseClone;
    const firstPhaseClone = { ...phases[0] };

    if (phaseStartDate) {
      phaseClone.dateStarted = getValidDate(assumeUtc(phaseStartDate));
    }
    if (experiment.status === "stopped" && phaseEndDate) {
      phaseClone.dateEnded = getValidDate(assumeUtc(phaseEndDate));
      // update both phases when stopped
      if (experiment.type === "holdout") {
        firstPhaseClone.dateEnded = getValidDate(assumeUtc(phaseEndDate));
        phases[0] = firstPhaseClone; // update the first phase to the same date ended
      }
    }
    changes.phases = phases;
  }

  // Clean up some vars for bandits, but only if safe to do so...
  // If it's a draft, hasn't been run as a bandit before, and is/will be a MAB:
  const resetDraftBandit =
    experiment.status === "draft" &&
    experiment.banditStage === undefined &&
    ((data.type === undefined && experiment.type === "multi-armed-bandit") ||
      data.type === "multi-armed-bandit");
  if (resetDraftBandit) {
    changes = resetExperimentBanditSettings({
      experiment,
      metricMap,
      changes,
      settings,
    });
  }
  // If it's already a bandit and..
  if (experiment.type === "multi-armed-bandit") {
    // ...the schedule has changed, recompute next run
    if (
      changes.banditScheduleUnit !== undefined ||
      changes.banditScheduleValue !== undefined ||
      changes.banditBurnInUnit !== undefined ||
      changes.banditBurnInValue !== undefined
    ) {
      changes.nextSnapshotAttempt = determineNextBanditSchedule({
        ...experiment,
        ...changes,
      } as ExperimentInterface);
    }
  }

  const phaseChanges = Object.fromEntries(
    Object.entries(data).filter(
      ([key, value]) => isPhaseField(key) && value !== undefined,
    ),
  ) as Partial<ExperimentPhase>;
  if (experiment.type === "holdout") {
    // Kept the same in every phase, which a holdout's analysis reads.
    const { coverage, condition, savedGroups, ...other } = phaseChanges;
    delete other.variationWeights;
    if (release?.newPhase || Object.keys(other).length) {
      throw new BadRequestError(
        "A holdout's targeting is its condition, saved groups and size, the same in every phase.",
      );
    }
    const holdoutTargeting = Object.fromEntries(
      Object.entries({ coverage, condition, savedGroups }).filter(
        ([, value]) => value !== undefined,
      ),
    );
    if (Object.keys(holdoutTargeting).length) {
      changes.phases = (changes.phases || [...experiment.phases]).map(
        (phase) => ({ ...phase, ...holdoutTargeting }),
      );
    }
  } else {
    const phases = [...(changes.phases || experiment.phases)];
    const last = phases.length - 1;
    // The phase's variations follow the experiment's, in their order; a new
    // phase takes them, and the one it ends keeps those it ran with.
    const phaseVariations = data.variations?.map((v) => ({
      id: v.id,
      status: "active" as const,
    }));
    if (phaseVariations && last >= 0 && !release?.newPhase) {
      phases[last] = { ...phases[last], variations: phaseVariations };
    }
    if (release?.newPhase || (last < 0 && Object.keys(phaseChanges).length)) {
      const previous = last >= 0 ? phases[last] : null;
      // The first phase starts from what the page shows before there is one.
      const from =
        previous ?? getTargetingDefaults({ ...experiment, phases }, 2);
      if (previous) phases[last] = { ...previous, dateEnded: new Date() };
      phases.push({
        coverage: from.coverage,
        variationWeights: from.variationWeights,
        variations: phaseVariations ?? from.variations,
        condition: from.condition,
        savedGroups: from.savedGroups,
        prerequisites: from.prerequisites,
        namespace: from.namespace,
        seed: from.seed,
        ...phaseChanges,
        ...(last >= 0 && release?.reseed && { seed: uuidv4() }),
        dateStarted: new Date(),
        name: "Main",
        reason: "",
      });
    } else if (Object.keys(phaseChanges).length) {
      phases[last] = { ...phases[last], ...phaseChanges };
    }
    if (phases.some((phase, i) => phase !== experiment.phases[i])) {
      changes.phases = phases;
    }
  }

  // A running bandit's learning holds while it targets the same people the
  // same way; anything else starts it over.
  if (experiment.type === "multi-armed-bandit" && !resetDraftBandit) {
    const moved = Object.keys(data).filter(
      (key) =>
        (isPhaseField(key) || BUCKETING_FIELDS.includes(key)) &&
        !sameFieldValue(
          key,
          data[key as keyof typeof data],
          experimentFieldValue(experiment, key),
        ),
    );
    if (release?.newPhase || !onlyTrafficFields(moved)) {
      changes = resetExperimentBanditSettings({
        experiment,
        metricMap,
        changes,
        settings,
      });
    }
  }

  // Also checked on the write; here so a dry run and linked flag writes refuse first.
  if (changes.phases) {
    assertValidExperimentPhases(changes.phases, experiment.phases);
  }

  await assertCanRunExperimentChanges(context, experiment, changes);
  await validateExperimentChange({ context, experiment, changes });

  return { changes, holdout, tags: data.tags || [] };
}

export async function applyExperimentUpdatePlan(args: {
  context: ReqContext;
  experiment: ExperimentInterface;
  plan: ExperimentUpdatePlan;
  audit: (data: AuditInterfaceInput) => Promise<void>;
}): Promise<ExperimentInterface> {
  const updated = await writeExperimentUpdatePlan(args);
  await finishExperimentUpdate({ ...args, updated });
  return updated;
}

// The experiment write itself: once it resolves the update has landed.
export async function writeExperimentUpdatePlan({
  context,
  experiment,
  plan,
  guard,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  plan: ExperimentUpdatePlan;
  guard?: Record<string, unknown>;
}): Promise<ExperimentInterface> {
  const { changes, holdout } = plan;
  const updated = await updateExperiment({
    context,
    experiment,
    changes,
    guard,
  });
  // After the guarded write, so a refused one leaves both holdouts as they were;
  // joining before leaving, so a failed join leaves the old holdout as it was.
  if (holdout.add) {
    await context.models.holdout.addExperimentToHoldout(
      holdout.add,
      experiment.id,
    );
  }
  if (holdout.remove) {
    await context.models.holdout.removeExperimentFromHoldout(
      holdout.remove,
      experiment.id,
    );
  }
  return updated;
}

export async function finishExperimentUpdate({
  context,
  experiment,
  updated,
  plan,
  audit,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  updated: ExperimentInterface;
  plan: ExperimentUpdatePlan;
  audit: (data: AuditInterfaceInput) => Promise<void>;
}): Promise<void> {
  const { changes } = plan;
  if (changes.variations) {
    await syncVisualChangesetsAndUrlRedirectsForExperiment({
      context,
      updated,
    });
  }
  if (changes.name || changes.description || changes.hypothesis) {
    const aiSettings = await getAISettingsForOrg(context);
    if (aiSettings.aiEnabled) {
      await generateExperimentEmbeddings(context, [updated]);
    }
  }

  await audit({
    event: "experiment.update",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

  await addTagsDiff(context.org.id, experiment.tags || [], plan.tags);

  await context.models.watch.upsertWatch({
    userId: context.userId,
    item: experiment.id,
    type: "experiments",
  });
}
