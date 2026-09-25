import { getValidDate } from "shared/dates";
import {
  canChangeImplementationType,
  includeExperimentInPayload,
} from "shared/util";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { getScopedSettings } from "shared/settings";
import {
  Changeset,
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import type { AuditInterfaceInput } from "shared/types/audit";
import { getMetricMap } from "back-end/src/models/MetricModel";
import {
  applyVariationWeightsToLatestPhase,
  assertCanRunExperimentChanges,
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
import { assertExperimentPrecomputedUnitDimensionIdsAreValid } from "back-end/src/services/dimensions";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { ReqContext } from "back-end/types/request";
import { BadRequestError, ForbiddenError } from "back-end/src/util/errors";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import {
  assertManagedFlagCanMove,
  getManagedFeatureForExperiment,
  moveManagedFlagWithExperiment,
  releaseManagedFlagForImplementationChange,
} from "back-end/src/services/managedFeatures";
import {
  shouldValidateCustomFieldsOnUpdate,
  validateCustomFieldsForSection,
} from "back-end/src/util/custom-fields";
import { getLivePayloadChanges } from "back-end/src/services/experimentLivePayload";
import { validateChangedPhaseReferences } from "back-end/src/api/features/validations";
import { getHoldoutAvailableForProject } from "back-end/src/services/holdout-availability";

export type ExperimentUpdateInput = Partial<ExperimentInterfaceStringDates> & {
  currentPhase?: number;
  phaseStartDate?: string;
  phaseEndDate?: string;
  variationWeights?: number[];
  coverage?: number;
  isVariationKeyReconciliation?: boolean;
};

export type ExperimentUpdatePlan = {
  changes: Changeset;
  releaseManagedFlagFor: ExperimentInterface["implementationType"];
  holdout: { remove: string | null; add: string | null };
  tags: string[];
};

const UPDATABLE_KEYS: (keyof ExperimentInterface)[] = [
  "trackingKey",
  "owner",
  "datasource",
  "exposureQueryId",
  "userIdType",
  "hashAttribute",
  "fallbackAttribute",
  "disableStickyBucketing",
  "hashVersion",
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
  "implementationType",
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

  if (data.implementationType === "multi") {
    throw new BadRequestError("implementationType cannot be set to multi");
  }
  // Against the flag actually managed, not the stored label; the release waits until every check passes.
  let releaseManagedFlagFor: ExperimentInterface["implementationType"];
  if (data.implementationType !== undefined) {
    const managed = await getManagedFeatureForExperiment(context, experiment);
    const current = managed ? "values" : experiment.implementationType;
    if (data.implementationType !== current) {
      const afterRelease =
        managed && data.implementationType !== "feature"
          ? {
              ...experiment,
              linkedFeatures: (experiment.linkedFeatures ?? []).filter(
                (id) => id !== managed.id,
              ),
            }
          : experiment;
      if (!canChangeImplementationType(afterRelease, data.implementationType)) {
        throw new BadRequestError(
          "Remove the experiment's linked Feature Flags, Visual Editor changes and URL Redirects before changing how it is implemented.",
        );
      }
      if (managed) releaseManagedFlagFor = data.implementationType;
    }
  }

  const attributeScope = lazyAttributeScope(() =>
    getExperimentAttributeScopeProjects(context, {
      project: "project" in data ? data.project : experiment.project,
      linkedFeatures: experiment.linkedFeatures,
    }),
  );
  await assertRegisteredAttributesScoped(
    context,
    {
      hashAttribute: data.hashAttribute,
      fallbackAttribute: data.fallbackAttribute,
    },
    "experiment",
    {
      hashAttribute: experiment.hashAttribute,
      fallbackAttribute: experiment.fallbackAttribute,
    },
    attributeScope,
  );
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
  // Ideally we validate custom fields everytime, but we need to update our UI to support that.
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
      throw new ForbiddenError("Invalid datasource: " + data.datasource);
    }
  }
  // Validate that specified metrics exist and belong to the organization
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
        // Make sure it is tied to the same datasource as the experiment
        if (datasourceId && metric.datasource !== datasourceId) {
          throw new BadRequestError(
            "Metrics must be tied to the same datasource as the experiment: " +
              newMetricIds[i],
          );
        }
      } else {
        // check to see if this metric is actually a metric group
        const metricGroup = await context.models.metricGroups.getById(
          newMetricIds[i],
        );
        if (metricGroup) {
          // Make sure it is tied to the same datasource as the experiment
          if (metricGroup.datasource !== datasourceId) {
            throw new BadRequestError(
              "Metric group must be tied to the same datasource as the experiment: " +
                newMetricIds[i],
            );
          }
        } else {
          // new metric that's not recognized...
          invalidMetricIds.push(newMetricIds[i]);
          // TODO: Commented out as a hotfix. Remove when issue #5316 is fixed.
          // throw new ForbiddenError("Unknown metric: " + newMetricIds[i]);
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

  const { changesLivePayload, changedFields: changedPayloadFields } =
    getLivePayloadChanges(experiment, {
      variations: data.variations,
      coverage: data.coverage,
      variationWeights: data.variationWeights,
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

  // Check if tracking key is being changed and validate uniqueness if required
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

  if (data.holdoutId && data.holdoutId !== experiment.holdoutId) {
    await getHoldoutAvailableForProject({
      context,
      holdoutId: data.holdoutId,
      project: data.project ?? experiment.project,
    });
  } else if (data.project !== undefined && experiment.holdoutId) {
    await getHoldoutAvailableForProject({
      context,
      holdoutId: experiment.holdoutId,
      project: data.project,
    });
  }

  // TODO(holdouts): allow changing holdout if the experiment is not linked to a feature
  // in the live! feature revision
  const experimentHasLinkedChanges =
    experiment.hasURLRedirects ||
    experiment.hasVisualChangesets ||
    (experiment.linkedFeatures && experiment.linkedFeatures.length > 0);
  const holdout: ExperimentUpdatePlan["holdout"] = { remove: null, add: null };
  if (
    // Holdout change
    data.holdoutId &&
    data.holdoutId !== experiment.holdoutId &&
    experiment.holdoutId
  ) {
    if (experiment.status !== "draft" || experimentHasLinkedChanges) {
      throw new Error(
        "Cannot change holdout after experiment has been run or linked changes have been added",
      );
    }
    holdout.remove = experiment.holdoutId;
  } else if (
    // Holdout removal
    data.holdoutId === "" &&
    data.holdoutId !== experiment.holdoutId &&
    experiment.holdoutId
  ) {
    if (experiment.status !== "draft" || experimentHasLinkedChanges) {
      throw new Error(
        "Cannot remove experiment from holdout after experiment has been run or linked changes have been added",
      );
    }
    holdout.remove = experiment.holdoutId;
  }

  if (data.holdoutId && data.holdoutId !== experiment.holdoutId) {
    holdout.add = data.holdoutId;
  }

  if (data.defaultDashboardId) {
    const dashboard = await context.models.dashboards.getById(
      data.defaultDashboardId,
    );
    if (!dashboard) {
      throw new ForbiddenError("Invalid dashboard: " + data.defaultDashboardId);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (changes as any)[key] = data[key];
    }
  });

  normalizeStatusUpdateScheduleChanges(experiment, changes);

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

  // Coerce lookbackOverride date value when type is "date"
  if (changes.lookbackOverride?.type === "date") {
    changes.lookbackOverride = {
      type: "date",
      value: getValidDate(changes.lookbackOverride.value),
    };
  }

  const shouldValidatePrecomputedUnitDimensionIds =
    changes.precomputedUnitDimensionIds !== undefined ||
    changes.datasource !== undefined ||
    changes.exposureQueryId !== undefined;
  if (shouldValidatePrecomputedUnitDimensionIds) {
    const effectivePrecomputedUnitDimensionIds =
      changes.precomputedUnitDimensionIds ??
      experiment.precomputedUnitDimensionIds ??
      [];
    const effectiveDatasourceId =
      changes.datasource ?? experiment.datasource ?? "";
    const effectiveExposureQueryId =
      changes.exposureQueryId ?? experiment.exposureQueryId;
    if (effectivePrecomputedUnitDimensionIds.length > 0) {
      const effectiveDatasource = effectiveDatasourceId
        ? await getDataSourceById(context, effectiveDatasourceId)
        : null;
      await assertExperimentPrecomputedUnitDimensionIdsAreValid({
        context,
        datasource: effectiveDatasource,
        exposureQueryId: effectiveExposureQueryId,
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
    phases[Math.floor(currentPhase * 1)] = phaseClone;
    const firstPhaseClone = { ...phases[0] };

    if (phaseStartDate) {
      phaseClone.dateStarted = getValidDate(phaseStartDate + ":00Z");
    }
    if (experiment.status === "stopped" && phaseEndDate) {
      phaseClone.dateEnded = getValidDate(phaseEndDate + ":00Z");
      // update both phases when stopped
      if (experiment.type === "holdout") {
        firstPhaseClone.dateEnded = getValidDate(phaseEndDate + ":00Z");
        phases[0] = firstPhaseClone; // update the first phase to the same date ended
      }
    }
    changes.phases = phases;
  }

  // Clean up some vars for bandits, but only if safe to do so...
  // If it's a draft, hasn't been run as a bandit before, and is/will be a MAB:
  if (
    experiment.status === "draft" &&
    experiment.banditStage === undefined &&
    ((data.type === undefined && experiment.type === "multi-armed-bandit") ||
      data.type === "multi-armed-bandit")
  ) {
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

  if (experiment.type === "holdout") {
    // Holdout targeting is handled by postExperimentTargeting, so coverage is
    // the only payload-affecting field this path handles; apply it to every phase.
    if (data.coverage !== undefined) {
      const coverage = data.coverage;
      const phases = changes.phases || [...experiment.phases];
      changes.phases = phases.map((phase) => ({ ...phase, coverage }));
    }
  } else {
    if (data.variationWeights) {
      changes.phases = applyVariationWeightsToLatestPhase(
        experiment,
        data.variationWeights,
      );
    }

    // Re-order phase variations to match the order of the variations coming in via the request body
    if (data.variations) {
      const phases = changes.phases || [...experiment.phases];
      const lastIndex = phases.length - 1;
      phases[lastIndex] = {
        ...phases[lastIndex],
        variations: data.variations.map((v) => ({
          id: v.id,
          status: "active" as const,
        })),
      };
      changes.phases = phases;
    }

    if (data.coverage !== undefined) {
      const coverage = data.coverage;
      const phases = changes.phases || [...experiment.phases];
      const lastIndex = phases.length - 1;
      phases[lastIndex] = { ...phases[lastIndex], coverage };
      changes.phases = phases;
    }
  }

  await assertCanRunExperimentChanges(context, experiment, changes);

  if ("project" in changes) {
    await assertManagedFlagCanMove(context, experiment, changes.project ?? "");
  }
  await validateExperimentChange({ context, experiment, changes });

  return { changes, releaseManagedFlagFor, holdout, tags: data.tags || [] };
}

export async function applyExperimentUpdatePlan(args: {
  context: ReqContext;
  experiment: ExperimentInterface;
  plan: ExperimentUpdatePlan;
  audit: (data: AuditInterfaceInput) => Promise<void>;
}): Promise<ExperimentInterface> {
  const { experiment, updated } = await writeExperimentUpdatePlan(args);
  await finishExperimentUpdate({ ...args, experiment, updated });
  return updated;
}

// The experiment write itself: once it resolves the update has landed.
export async function writeExperimentUpdatePlan({
  context,
  experiment,
  plan,
  audit,
  guard,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  plan: ExperimentUpdatePlan;
  audit: (data: AuditInterfaceInput) => Promise<void>;
  guard?: Record<string, unknown>;
}): Promise<{ experiment: ExperimentInterface; updated: ExperimentInterface }> {
  const { changes, releaseManagedFlagFor, holdout } = plan;

  // First: it can still refuse (unacknowledged 422) before anything is written.
  if (releaseManagedFlagFor) {
    experiment = await releaseManagedFlagForImplementationChange({
      context,
      experiment,
      next: releaseManagedFlagFor,
      audit,
      acknowledged: context.ignoreWarnings,
    });
  }
  if (holdout.remove) {
    await context.models.holdout.removeExperimentFromHoldout(
      holdout.remove,
      experiment.id,
    );
  }
  if (holdout.add) {
    await context.models.holdout.addExperimentToHoldout(
      holdout.add,
      experiment.id,
    );
  }

  const updated = await updateExperiment({
    context,
    experiment,
    changes,
    guard,
  });
  return { experiment, updated };
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
  if ("project" in changes) {
    await moveManagedFlagWithExperiment(context, updated);
  }
  if (changes.name || changes.description || changes.hypothesis) {
    const aiSettings = await getAISettingsForOrg(context);
    // If name, description or hypothesis changed, update the vectors:
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

  // If there are new tags to add
  await addTagsDiff(context.org.id, experiment.tags || [], plan.tags);

  await context.models.watch.upsertWatch({
    userId: context.userId,
    item: experiment.id,
    type: "experiments",
  });
}
