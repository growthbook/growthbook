import { omit } from "lodash";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import {
  parseAssignmentQueryInput,
  resolveAssignmentQuerySelectionChange,
} from "shared/util";
import {
  ExperimentInterfaceExcludingHoldouts,
  updateExperimentValidator,
} from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  updateExperiment as updateExperimentToDb,
  getExperimentById,
  getExperimentByTrackingKey,
} from "back-end/src/models/ExperimentModel";
import {
  assertCanRunExperimentChanges,
  assertExperimentKeyFormat,
  normalizeStatusUpdateScheduleChanges,
  toExperimentApiInterface,
  getExperimentAttributeScopeProjects,
  updateExperimentApiPayloadToInterface,
  UpdateExperimentApiPayload,
  validateVariationIds,
} from "back-end/src/services/experiments";
import {
  assertRegisteredAttributesScoped,
  lazyAttributeScope,
} from "back-end/src/services/attributes";
import { validateScheduleUpdate } from "back-end/src/services/experimentScheduling";
import { assertLivePayloadChangeAllowed } from "back-end/src/services/experimentLivePayload";
import {
  assertValidExperimentPrerequisites,
  phasePrerequisites,
} from "back-end/src/services/prerequisiteParents";
import { validateChangedPhaseReferences } from "back-end/src/api/features/validations";
import {
  startExperiment,
  validateExperimentChange,
} from "back-end/src/services/experimentChanges/changeExperimentStatus";
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

  const assignmentQueryInput = parseAssignmentQueryInput(
    req.body.assignmentQuery,
    req.body.assignmentQueryId,
    "assignmentQuery",
  );
  /**
   * req.body without the grouped assignmentQuery, which assignmentQueryInput
   * already folded into the flat fields. Read these, not req.body.
   */
  const payload: UpdateExperimentApiPayload = {
    ...omit(req.body, "assignmentQuery"),
    assignmentQueryId: assignmentQueryInput.id,
  };

  // Validate projects - We can remove this validation when ExperimentModel is migrated to BaseModel
  if (payload.project) {
    await req.context.models.projects.ensureProjectsExist([payload.project]);
  }

  if (!req.context.permissions.canUpdateExperiment(experiment, payload)) {
    req.context.permissions.throwPermissionError();
  }

  assertExperimentPayloadCommercialFeatures(req.context, {
    postStratificationEnabled: payload.postStratificationEnabled,
    decisionFrameworkSettings: payload.decisionFrameworkSettings,
    metricOverrides: payload.metricOverrides,
    defaultDashboardId: payload.defaultDashboardId,
  });

  // validate datasource only if updating
  const datasourceId = payload.datasourceId ?? experiment.datasource;
  const datasource = datasourceId
    ? await getDataSourceById(req.context, datasourceId)
    : null;

  if (
    payload.datasourceId !== undefined &&
    payload.datasourceId !== experiment.datasource
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

  /** Stored after this write; undefined leaves the experiment implicit. */
  let exposureQueryIdentifierType = experiment.exposureQueryIdentifierType;
  if (
    payload.assignmentQueryId !== undefined ||
    assignmentQueryInput.identifierType !== undefined
  ) {
    if (!datasource) {
      throw new Error("Datasource not found.");
    }
    const resolved = resolveAssignmentQuerySelectionChange(
      datasource.settings.queries?.exposure ?? [],
      {
        previous: {
          datasource: experiment.datasource ?? "",
          exposureQueryId: experiment.exposureQueryId,
          identifierType: experiment.exposureQueryIdentifierType,
        },
        next: {
          datasource: datasource.id,
          exposureQueryId:
            payload.assignmentQueryId ?? experiment.exposureQueryId,
          identifierType: assignmentQueryInput.identifierType,
        },
        onOmitted: "requireUnambiguous",
        field: "assignmentQuery",
      },
    );
    if (!resolved.ok) throw new Error(resolved.error);
    exposureQueryIdentifierType = resolved.identifierType;
  }
  const identifierTypeChanged =
    exposureQueryIdentifierType !== experiment.exposureQueryIdentifierType;

  if (
    req.body.trackingKey !== undefined &&
    req.body.trackingKey !== experiment.trackingKey
  ) {
    await assertExperimentKeyFormat(
      req.context,
      req.body.trackingKey,
      datasourceId,
    );
  }

  // check if tracking key is unique
  const requireUniqueTrackingKeys =
    !!req.organization.settings?.requireUniqueExperimentTrackingKeys;
  if (
    payload.trackingKey != null &&
    payload.trackingKey !== experiment.trackingKey &&
    (requireUniqueTrackingKeys || !payload.bypassDuplicateKeyCheck)
  ) {
    const existingByTrackingKey = await getExperimentByTrackingKey(
      req.context,
      payload.trackingKey,
    );
    if (existingByTrackingKey) {
      // If organization requires unique tracking keys, always reject duplicates
      if (requireUniqueTrackingKeys) {
        throw new Error(
          `Experiment with tracking key already exists: ${payload.trackingKey}. Your organization requires unique experiment tracking keys and bypassDuplicateKeyCheck is ignored.`,
        );
      }
      if (!payload.bypassDuplicateKeyCheck) {
        throw new Error(
          `Experiment with tracking key already exists: ${payload.trackingKey}.`,
        );
      }
    }
  }

  const projectChanged =
    payload.project !== undefined && payload.project !== experiment.project;
  const customFieldsChanged = shouldValidateCustomFieldsOnUpdate({
    existingCustomFieldValues: experiment.customFields,
    updatedCustomFieldValues: payload.customFields,
  });

  if (projectChanged || customFieldsChanged) {
    await validateCustomFields(
      payload.customFields ?? experiment.customFields,
      req.context,
      payload.project ?? experiment.project,
      // A project change must re-validate all values against the new
      // project's fields, so only grandfather unchanged values in place
      projectChanged ? undefined : experiment.customFields,
    );
  }

  if (payload.defaultDashboardId) {
    const dashboard = await req.context.models.dashboards.getById(
      payload.defaultDashboardId,
    );
    if (!dashboard) {
      throw new Error(`Invalid dashboard: ${payload.defaultDashboardId}`);
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
      goalMetrics: payload.metrics,
      secondaryMetrics: payload.secondaryMetrics,
      guardrailMetrics: payload.guardrailMetrics,
      activationMetric: payload.activationMetric,
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

  if (payload.variations) {
    validateVariationIds(payload.variations, experiment.variations);
  }

  const effectivePrecomputedUnitDimensionType =
    payload.type ?? experiment.type ?? "standard";
  if (effectivePrecomputedUnitDimensionType === "multi-armed-bandit") {
    // If request includes precomputed unit dimensions for a bandit, error
    if (payload.precomputedUnitDimensionIds !== undefined) {
      throw new Error(
        "Precomputed unit dimensions are not supported for bandit experiments",
      );
    }
    // if experiment is just switching to a bandit, silently clear precomputed unit dimensions
    if (payload.type === "multi-armed-bandit") {
      payload.precomputedUnitDimensionIds = [];
    }
  }

  const shouldValidatePrecomputedUnitDimensionIds =
    payload.precomputedUnitDimensionIds !== undefined ||
    (payload.datasourceId !== undefined &&
      payload.datasourceId !== experiment.datasource) ||
    (payload.assignmentQueryId !== undefined &&
      payload.assignmentQueryId !== experiment.exposureQueryId) ||
    identifierTypeChanged;
  if (shouldValidatePrecomputedUnitDimensionIds) {
    const effectivePrecomputedUnitDimensionIds =
      payload.precomputedUnitDimensionIds ??
      experiment.precomputedUnitDimensionIds ??
      [];
    if (effectivePrecomputedUnitDimensionIds.length > 0) {
      await assertExperimentPrecomputedUnitDimensionIdsAreValid({
        context: req.context,
        datasource,
        exposureQueryId:
          payload.assignmentQueryId ?? experiment.exposureQueryId,
        exposureQueryIdentifierType,
        dimensionIds: effectivePrecomputedUnitDimensionIds,
      });
    }
  }

  if (
    payload.type &&
    payload.type !== (experiment.type || "standard") &&
    experiment.status !== "draft" &&
    payload.status !== "draft"
  ) {
    throw new Error("Can only convert experiment types while in draft mode.");
  }

  // Validate attributionModel + lookbackOverride consistency
  const effectiveAttrModel =
    payload.attributionModel ?? experiment.attributionModel;
  const effectiveLookback =
    payload.lookbackOverride !== undefined
      ? payload.lookbackOverride
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
    payload.lookbackOverride !== undefined
  ) {
    throw new Error(
      "lookbackOverride is only allowed when attributionModel is 'lookbackOverride'",
    );
  }

  const attributeScope = lazyAttributeScope(() =>
    getExperimentAttributeScopeProjects(req.context, {
      project:
        payload.project !== undefined ? payload.project : experiment.project,
      linkedFeatures: experiment.linkedFeatures,
    }),
  );
  await assertRegisteredAttributesScoped(
    req.context,
    {
      hashAttribute: payload.hashAttribute,
      fallbackAttribute: payload.fallbackAttribute,
    },
    "experiment",
    {
      hashAttribute: experiment.hashAttribute,
      fallbackAttribute: experiment.fallbackAttribute,
    },
    attributeScope,
  );
  // Match persisted phases by condition value, not index — clients that
  // insert or delete phases must not re-validate grandfathered conditions.
  const persistedConditions = new Set(
    (experiment.phases ?? []).map((p) => p.condition),
  );
  for (const phase of payload.phases ?? []) {
    await assertRegisteredAttributesScoped(
      req.context,
      { condition: phase.condition },
      "experiment phase",
      {
        condition:
          phase.condition !== undefined &&
          persistedConditions.has(phase.condition)
            ? phase.condition
            : undefined,
      },
      attributeScope,
    );
  }

  const resolvedOwner = await resolveOwnerToUserId(payload.owner, req.context);
  const changes = {
    ...updateExperimentApiPayloadToInterface(
      {
        ...payload,
        ...(payload.owner !== undefined && { owner: resolvedOwner ?? "" }),
      },
      experiment,
      map,
      req.organization,
    ),
    // Undefined when the new selection is implicit, which clears the old one.
    ...(identifierTypeChanged ? { exposureQueryIdentifierType } : {}),
  };

  normalizeStatusUpdateScheduleChanges(experiment, changes, req.context.armer);

  // canUpdateExperiment (above) is the analysis-level check. Fields that reach
  // SDK payloads additionally need run-experiments permission in the
  // environments the experiment affects — the same rule, on the same fields,
  // as the dashboard's POST /experiment/:id.
  await assertCanRunExperimentChanges(req.context, experiment, changes);

  // Linked feature rules would keep the old variation ids; the dashboard
  // refuses this too. Coverage and weights stay editable, as in its targeting flow.
  await assertLivePayloadChangeAllowed(req.context, experiment, {
    variations: changes.variations,
  });
  // The served (latest) phase is checked against the latest stored phase;
  // earlier phases are history, so any parent the stored experiment already
  // references is not re-validated when they are echoed or reordered.
  if (changes.phases) {
    await validateChangedPhaseReferences(
      changes.phases,
      experiment.phases,
      req.context,
    );
    await assertValidExperimentPrerequisites(
      req.context,
      changes.phases[changes.phases.length - 1]?.prerequisites,
      experiment.phases[experiment.phases.length - 1]?.prerequisites,
    );
    await assertValidExperimentPrerequisites(
      req.context,
      phasePrerequisites(changes.phases.slice(0, -1)),
      phasePrerequisites(experiment.phases),
    );
  }

  // Same validation as PUT /schedule, against the stored schedule and the
  // post-update variations/metrics.
  if (payload.statusUpdateSchedule) {
    validateScheduleUpdate({
      context: req.context,
      experimentType: payload.type ?? experiment.type ?? "standard",
      status: experiment.status,
      archived: !!experiment.archived,
      phaseStart: experiment.phases[experiment.phases.length - 1]?.dateStarted,
      existingSchedule: experiment.statusUpdateSchedule,
      variations: changes.variations ?? experiment.variations,
      goalMetrics: changes.goalMetrics ?? experiment.goalMetrics,
      incoming: payload.statusUpdateSchedule,
    });
  }

  const isStartingFromDraft =
    experiment.status === "draft" && changes.status === "running";

  await validateExperimentChange({ context: req.context, experiment, changes });

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
