import { getAllMetricIdsFromExperiment } from "shared/experiments";
import {
  ExperimentInterfaceExcludingHoldouts,
  Variation,
  updateExperimentValidator,
} from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  updateExperiment as updateExperimentToDb,
  getExperimentById,
  getExperimentByTrackingKey,
} from "back-end/src/models/ExperimentModel";
import {
  normalizeStatusUpdateScheduleChanges,
  toExperimentApiInterface,
  updateExperimentApiPayloadToInterface,
  validateStatusUpdateSchedule,
  validateVariationIds,
} from "back-end/src/services/experiments";
import { assertRegisteredAttributes } from "back-end/src/services/attributes";
import { startExperiment } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { validateScheduledStopPlan } from "back-end/src/services/experimentScheduling";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  resolveOwnerEmail,
  resolveOwnerToUserId,
} from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { assertExperimentPrecomputedUnitDimensionIdsAreValid } from "back-end/src/services/dimensions";
import { shouldValidateCustomFieldsOnUpdate } from "back-end/src/util/custom-fields";
import { getMetricMap } from "back-end/src/models/MetricModel";
import {
  assertExperimentPayloadCommercialFeatures,
  validateCustomFields,
} from "./validations";

export const updateExperiment = createApiRequestHandler(
  updateExperimentValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find the experiment to update");
  }
  if (experiment.type === "holdout") {
    throw new Error("Holdouts are not supported via this API");
  }

  // Validate projects - We can remove this validation when ExperimentModel is migrated to BaseModel
  if (req.body.project) {
    await req.context.models.projects.ensureProjectsExist([req.body.project]);
  }

  if (!req.context.permissions.canUpdateExperiment(experiment, req.body)) {
    req.context.permissions.throwPermissionError();
  }

  assertExperimentPayloadCommercialFeatures(req.context, {
    postStratificationEnabled: req.body.postStratificationEnabled,
    decisionFrameworkSettings: req.body.decisionFrameworkSettings,
    metricOverrides: req.body.metricOverrides,
    defaultDashboardId: req.body.defaultDashboardId,
  });

  // validate datasource only if updating
  const datasourceId = req.body.datasourceId ?? experiment.datasource;
  const datasource = datasourceId
    ? await getDataSourceById(req.context, datasourceId)
    : null;

  if (
    req.body.datasourceId !== undefined &&
    req.body.datasourceId !== experiment.datasource
  ) {
    if (experiment.datasource) {
      throw new Error(
        "Cannot change datasource via API if one is already set.",
      );
    }
    if (!datasource) {
      throw new Error("Datasource not found.");
    }
  }

  // check for associated assignment query id
  if (
    req.body.assignmentQueryId !== undefined &&
    req.body.assignmentQueryId !== experiment.exposureQueryId
  ) {
    if (!datasource) {
      throw new Error("Datasource not found.");
    }
    if (
      !datasource.settings.queries?.exposure?.some(
        (q) => q.id === req.body.assignmentQueryId,
      )
    ) {
      throw new Error(
        `Unrecognized assignment query ID: ${req.body.assignmentQueryId}`,
      );
    }
  }

  // check if tracking key is unique
  const requireUniqueTrackingKeys =
    !!req.organization.settings?.requireUniqueExperimentTrackingKeys;
  if (
    req.body.trackingKey != null &&
    req.body.trackingKey !== experiment.trackingKey &&
    (requireUniqueTrackingKeys || !req.body.bypassDuplicateKeyCheck)
  ) {
    const existingByTrackingKey = await getExperimentByTrackingKey(
      req.context,
      req.body.trackingKey,
    );
    if (existingByTrackingKey) {
      // If organization requires unique tracking keys, always reject duplicates
      if (requireUniqueTrackingKeys) {
        throw new Error(
          `Experiment with tracking key already exists: ${req.body.trackingKey}. Your organization requires unique experiment tracking keys and bypassDuplicateKeyCheck is ignored.`,
        );
      }
      if (!req.body.bypassDuplicateKeyCheck) {
        throw new Error(
          `Experiment with tracking key already exists: ${req.body.trackingKey}.`,
        );
      }
    }
  }

  const projectChanged =
    req.body.project !== undefined && req.body.project !== experiment.project;
  const customFieldsChanged = shouldValidateCustomFieldsOnUpdate({
    existingCustomFieldValues: experiment.customFields,
    updatedCustomFieldValues: req.body.customFields,
  });

  if (projectChanged || customFieldsChanged) {
    await validateCustomFields(
      req.body.customFields ?? experiment.customFields,
      req.context,
      req.body.project ?? experiment.project,
    );
  }

  if (req.body.defaultDashboardId) {
    const dashboard = await req.context.models.dashboards.getById(
      req.body.defaultDashboardId,
    );
    if (!dashboard) {
      throw new Error(`Invalid dashboard: ${req.body.defaultDashboardId}`);
    }
  }

  // Validate that specified metrics exist and belong to the organization
  const metricGroups = await req.context.models.metricGroups.getAll();
  const oldMetricIds = getAllMetricIdsFromExperiment(
    experiment,
    true,
    metricGroups,
  );
  const newMetricIds = getAllMetricIdsFromExperiment(
    {
      goalMetrics: req.body.metrics,
      secondaryMetrics: req.body.secondaryMetrics,
      guardrailMetrics: req.body.guardrailMetrics,
      activationMetric: req.body.activationMetric,
    },
    true,
    metricGroups,
  ).filter((m) => !oldMetricIds.includes(m));

  const map = await getMetricMap(req.context);

  if (newMetricIds.length) {
    if (!datasource) {
      throw new Error("Must provide a datasource when including metrics");
    }
    for (let i = 0; i < newMetricIds.length; i++) {
      const metric = map.get(newMetricIds[i]);
      if (metric) {
        // Make sure it is tied to the same datasource as the experiment
        if (datasource.id && metric.datasource !== datasource.id) {
          throw new Error(
            "Metrics must be tied to the same datasource as the experiment: " +
              newMetricIds[i],
          );
        }
      } else {
        // check to see if this metric is actually a metric group
        const metricGroup = await req.context.models.metricGroups.getById(
          newMetricIds[i],
        );
        if (metricGroup) {
          // Make sure it is tied to the same datasource as the experiment
          if (datasource.id && metricGroup.datasource !== datasource.id) {
            throw new Error(
              "Metrics must be tied to the same datasource as the experiment: " +
                newMetricIds[i],
            );
          }
        } else {
          // new metric that's not recognized...
          throw new Error("Unknown metric: " + newMetricIds[i]);
        }
      }
    }
  }

  if (req.body.variations) {
    // Resolve the `variationId` response-field alias to `id` before validating,
    // so echoing GET variations back doesn't regenerate ids (validateVariationIds
    // assigns a fresh id to any variation missing one).
    req.body.variations.forEach((v) => {
      if (!v.id && v.variationId) v.id = v.variationId;
    });
    validateVariationIds(req.body.variations as Variation[]);
  }

  const effectivePrecomputedUnitDimensionType =
    req.body.type ?? experiment.type ?? "standard";
  if (effectivePrecomputedUnitDimensionType === "multi-armed-bandit") {
    // If request includes precomputed unit dimensions for a bandit, error
    if (req.body.precomputedUnitDimensionIds !== undefined) {
      throw new Error(
        "Precomputed unit dimensions are not supported for bandit experiments",
      );
    }
    // if experiment is just switching to a bandit, silently clear precomputed unit dimensions
    if (req.body.type === "multi-armed-bandit") {
      req.body.precomputedUnitDimensionIds = [];
    }
  }

  const shouldValidatePrecomputedUnitDimensionIds =
    req.body.precomputedUnitDimensionIds !== undefined ||
    (req.body.datasourceId !== undefined &&
      req.body.datasourceId !== experiment.datasource) ||
    (req.body.assignmentQueryId !== undefined &&
      req.body.assignmentQueryId !== experiment.exposureQueryId);
  if (shouldValidatePrecomputedUnitDimensionIds) {
    const effectivePrecomputedUnitDimensionIds =
      req.body.precomputedUnitDimensionIds ??
      experiment.precomputedUnitDimensionIds ??
      [];
    if (effectivePrecomputedUnitDimensionIds.length > 0) {
      await assertExperimentPrecomputedUnitDimensionIdsAreValid({
        context: req.context,
        datasource,
        exposureQueryId:
          req.body.assignmentQueryId ?? experiment.exposureQueryId,
        dimensionIds: effectivePrecomputedUnitDimensionIds,
      });
    }
  }

  if (
    req.body.type &&
    req.body.type !== (experiment.type || "standard") &&
    experiment.status !== "draft" &&
    req.body.status !== "draft"
  ) {
    throw new Error("Can only convert experiment types while in draft mode.");
  }

  // Validate attributionModel + lookbackOverride consistency
  const effectiveAttrModel =
    req.body.attributionModel ?? experiment.attributionModel;
  const effectiveLookback =
    req.body.lookbackOverride !== undefined
      ? req.body.lookbackOverride
      : experiment.lookbackOverride;
  if (effectiveAttrModel === "lookbackOverride" && !effectiveLookback) {
    throw new Error(
      "lookbackOverride is required when attributionModel is 'lookbackOverride'",
    );
  }
  // If lookbackOverride is provided in the payload, it must have the right
  // attribution model
  if (
    effectiveAttrModel !== "lookbackOverride" &&
    req.body.lookbackOverride !== undefined
  ) {
    throw new Error(
      "lookbackOverride is only allowed when attributionModel is 'lookbackOverride'",
    );
  }

  // Opt-in attribute registration check (org-level setting). Covers the
  // experiment-level hash/fallback attributes and every provided phase.
  assertRegisteredAttributes(
    req.context,
    {
      hashAttribute: req.body.hashAttribute,
      fallbackAttribute: req.body.fallbackAttribute,
    },
    "experiment",
    undefined,
    experiment.project,
  );
  for (const phase of req.body.phases ?? []) {
    assertRegisteredAttributes(
      req.context,
      { condition: phase.condition },
      "experiment phase",
      undefined,
      experiment.project,
    );
  }

  if (req.body.statusUpdateSchedule) {
    const effectiveType = req.body.type ?? experiment.type ?? "standard";
    validateStatusUpdateSchedule(
      effectiveType,
      req.body.statusUpdateSchedule,
      experiment,
    );
  }

  const resolvedOwner = await resolveOwnerToUserId(req.body.owner, req.context);
  const changes = updateExperimentApiPayloadToInterface(
    {
      ...req.body,
      ...(req.body.owner !== undefined && { owner: resolvedOwner ?? "" }),
    },
    experiment,
    map,
    req.organization,
  );

  normalizeStatusUpdateScheduleChanges(experiment, changes);

  // Run the same scheduled-stop-plan validation as PUT /schedule so this body
  // path can't set an invalid config (e.g. a force-ship fallbackVariationId that
  // doesn't match a variation). Validate against the post-update schedule + variations.
  if (changes.scheduledStopPlan) {
    const effectiveSchedule =
      "statusUpdateSchedule" in changes
        ? changes.statusUpdateSchedule
        : experiment.statusUpdateSchedule;
    const hasScheduledEnd = !!(
      effectiveSchedule?.stopAt || effectiveSchedule?.stopAfter
    );
    validateScheduledStopPlan(
      req.context,
      { ...experiment, ...changes },
      changes.scheduledStopPlan,
      hasScheduledEnd,
    );
  }

  const isStartingFromDraft =
    experiment.status === "draft" && changes.status === "running";

  let experimentForUpdate = experiment;
  let changesForUpdate = changes;

  if (isStartingFromDraft) {
    // Persist the non-status changes (including any new statusUpdateSchedule)
    // BEFORE starting, so startExperiment -> executeExperimentStart resolves a
    // relative stopAfter off the real start time using the freshly-saved
    // schedule (rather than the stale pre-start draft).
    const remainingChanges = { ...changes };
    delete remainingChanges.status;
    if (Object.keys(remainingChanges).length > 0) {
      await updateExperimentToDb({
        context: req.context,
        experiment,
        changes: remainingChanges,
      });
    }
    // Route draft->running transitions through the dedicated lifecycle method
    // so ramp lockdown, checklist, and pending-draft publish behavior stays
    // consistent across all entry points.
    const { updated } = await startExperiment({
      context: req.context,
      experimentId: experiment.id,
      // behavior for patch endpoint is to skip pre-launch checklist
      skipChecklist: true,
    });
    experimentForUpdate = updated;
    // All non-status changes were already persisted above; startExperiment
    // handled the transition (and resolved the schedule), so nothing remains.
    changesForUpdate = {};
  }

  const updatedExperiment =
    Object.keys(changesForUpdate).length > 0
      ? await updateExperimentToDb({
          context: req.context,
          experiment: experimentForUpdate,
          changes: changesForUpdate,
        })
      : experimentForUpdate;

  if (updatedExperiment === null) {
    throw new Error("Error happened during updating experiment.");
  }

  await req.audit({
    event: "experiment.update",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updatedExperiment),
  });

  const apiExperiment = await resolveOwnerEmail(
    await toExperimentApiInterface(
      req.context,
      updatedExperiment as ExperimentInterfaceExcludingHoldouts,
    ),
    req.context,
  );
  return {
    experiment: apiExperiment,
  };
});
