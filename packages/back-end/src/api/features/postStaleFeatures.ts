import { isFeatureStale } from "shared/util";
import { PostStaleFeaturesResponse } from "back-end/types/openapi";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { postStaleFeaturesValidator } from "back-end/src/validators/openapi";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getAllPayloadExperiments } from "back-end/src/models/ExperimentModel";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FeatureInterface } from "back-end/types/feature";
import { SafeRolloutInterface } from "back-end/types/safe-rollout";

/**
 * Extracts the effective value for a specific environment that should be used when removing a stale feature.
 */
function getEffectiveValueForEnvironment(
  feature: FeatureInterface,
  reason: "no-rules" | "rules-one-sided" | "error" | undefined,
  envId: string,
  experiments: ExperimentInterfaceStringDates[],
  safeRolloutMap: Map<string, SafeRolloutInterface>,
): string {
  const envSettings = feature.environmentSettings[envId];

  if (!envSettings?.enabled) {
    return feature.defaultValue;
  }

  if (!reason || reason === "no-rules" || reason === "error") {
    return feature.defaultValue;
  }

  const experimentMap = new Map(experiments.map((exp) => [exp.id, exp]));

  const rules = envSettings.rules || [];
  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    if (rule.type === "force") {
      return rule.value;
    }

    // For rollout rules with coverage=1 (which is the case for one-sided rules),  return the value since it applies to everyone
    if (rule.type === "rollout") {
      return rule.value;
    }

    // For safe-rollout rules, check the status
    // If released, return the variation value; if rolled back, return control value
    // If in progress with coverage=1 (one-sided), return the variation value
    if (rule.type === "safe-rollout") {
      const safeRollout = safeRolloutMap.get(rule.safeRolloutId);
      if (!safeRollout) {
        continue;
      }

      if (rule.status === "released" && rule.variationValue != null) {
        return rule.variationValue;
      }
      if (rule.status === "rolled-back" && rule.controlValue != null) {
        return rule.controlValue;
      }
      // For one-sided rules, safe-rollouts should have coverage=1, so return variation value
      if (rule.variationValue != null) {
        return rule.variationValue;
      }
      continue;
    }

    if (rule.type === "experiment-ref") {
      const experiment = experimentMap.get(rule.experimentId);
      if (
        experiment &&
        experiment.status === "stopped" &&
        experiment.releasedVariationId
      ) {
        // Find the variation value from the rule's variations array
        const variation = rule.variations.find(
          (v) => v.variationId === experiment.releasedVariationId,
        );
        if (variation) {
          return variation.value;
        }
      }
      // If experiment is still running, we can't determine a single value
      // (experiments have multiple variations), so continue to next rule
      continue;
    }

    if (rule.type === "experiment") {
      continue;
    }
  }

  return feature.defaultValue;
}

function getEffectiveValuesByEnvironment(
  feature: FeatureInterface,
  reason: "no-rules" | "rules-one-sided" | "error" | undefined,
  environments: string[],
  experiments: ExperimentInterfaceStringDates[],
  safeRolloutMap: Map<string, SafeRolloutInterface>,
): Record<string, { value: string }> {
  const environmentsObj: Record<string, { value: string }> = {};

  for (const envId of environments) {
    const effectiveValue = getEffectiveValueForEnvironment(
      feature,
      reason,
      envId,
      experiments,
      safeRolloutMap,
    );
    environmentsObj[envId] = { value: effectiveValue };
  }

  return environmentsObj;
}

export const postStaleFeatures = createApiRequestHandler(
  postStaleFeaturesValidator,
)(async (req): Promise<PostStaleFeaturesResponse> => {
  const { featureIds } = req.body;
  const { projectId } = req.query;

  const allFeatures = await getAllFeatures(req.context, {
    projects: projectId ? [projectId] : undefined,
    includeArchived: false, // Should we include archived features? Archived features are not necessarily marked as stale.
  });

  let featuresToCheck = allFeatures;
  if (featureIds && featureIds.length > 0) {
    const featureIdSet = new Set(featureIds);
    featuresToCheck = allFeatures.filter((f) => featureIdSet.has(f.id));
  }

  const experimentMap = await getAllPayloadExperiments(
    req.context,
    projectId ? [projectId] : undefined,
  );

  const experiments = Array.from(
    experimentMap.values(),
  ) as unknown as ExperimentInterfaceStringDates[];

  const safeRolloutMap =
    await req.context.models.safeRollout.getAllPayloadSafeRollouts();

  const environments =
    req.organization.settings?.environments?.map((e) => e.id) || [];

  // Sort by dateUpdated (oldest first) to prioritize the most stale features
  const sortedFeatures = featuresToCheck.sort(
    (a, b) => a.dateUpdated.getTime() - b.dateUpdated.getTime(),
  );

  const results = sortedFeatures.map((feature) => {
    const { stale, reason } = isFeatureStale({
      feature,
      features: allFeatures,
      experiments,
      environments,
    });

    const environmentsObj = getEffectiveValuesByEnvironment(
      feature,
      reason,
      environments,
      experiments,
      safeRolloutMap,
    );

    return {
      id: feature.id,
      owner: feature.owner,
      project: feature.project || "",
      archived: feature.archived || false,
      dateCreated: feature.dateCreated.toISOString(),
      dateUpdated: feature.dateUpdated.toISOString(),
      stale,
      ...(reason && { reason }),
      valueType: feature.valueType,
      environments: environmentsObj,
    };
  });

  // TODO: Move sorting/limiting to the database query for better performance
  const { filtered, returnFields } = applyPagination(results, req.query);

  return {
    features: filtered,
    ...returnFields,
  };
});
