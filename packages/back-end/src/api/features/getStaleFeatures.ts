import { isFeatureStale } from "shared/util";
import { GetStaleFeaturesResponse } from "back-end/types/openapi";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { getStaleFeaturesValidator } from "back-end/src/validators/openapi";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import { FeatureInterface } from "back-end/types/feature";
import { SafeRolloutInterface } from "back-end/types/safe-rollout";

/**
 * Extracts the effective value for a specific environment that should be used when removing a stale feature.
 */
function getEffectiveValueForEnvironment(
  feature: FeatureInterface,
  envId: string,
  experimentMap: Map<string, ExperimentInterface>,
  safeRolloutMap: Map<string, SafeRolloutInterface>,
): string | null {
  const envSettings = feature.environmentSettings[envId];
  const isArchived = feature.archived || false;
  const isDisabled = !envSettings?.enabled;

  // For disabled environments, always return null
  if (isDisabled) {
    return null;
  }

  const rules = envSettings.rules || [];
  for (const rule of rules) {
    // For experiment-ref rules, always check
    if (rule.type === "experiment-ref" && rule.experimentId) {
      const experiment = experimentMap.get(rule.experimentId);

      if (experiment) {
        if (
          experiment.status === "stopped" &&
          rule.variations &&
          rule.variations.length > 0
        ) {
          let variationIdToUse: string | undefined = undefined;

          if (
            experiment.releasedVariationId &&
            typeof experiment.releasedVariationId === "string" &&
            experiment.releasedVariationId.length > 0
          ) {
            variationIdToUse = experiment.releasedVariationId;
          } else if (
            experiment.winner != null &&
            experiment.variations &&
            experiment.variations.length > experiment.winner
          ) {
            const winningVariation = experiment.variations[experiment.winner];
            if (winningVariation && winningVariation.id) {
              variationIdToUse = winningVariation.id;
            }
          }

          if (variationIdToUse) {
            const variation = rule.variations.find(
              (v) => v.variationId && v.variationId === variationIdToUse,
            );
            if (
              variation &&
              variation.value != null &&
              variation.value !== ""
            ) {
              return variation.value;
            }
          }
        }
      }
      continue;
    }

    if (!rule.enabled) {
      continue;
    }

    if (rule.type === "force") {
      return rule.value;
    }

    if (rule.type === "rollout" && rule.coverage === 1) {
      return rule.value;
    }

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

      if (rule.variationValue != null) {
        const isOneSided =
          safeRollout.rampUpSchedule.rampUpCompleted ||
          !safeRollout.rampUpSchedule.enabled ||
          safeRollout.rampUpSchedule.steps[safeRollout.rampUpSchedule.step]
            ?.percent === 1;
        if (isOneSided) {
          return rule.variationValue;
        }
      }
      continue;
    }

    if (rule.type === "experiment") {
      continue;
    }
  }

  if (isArchived) {
    return null;
  }

  return feature.defaultValue;
}

function getEffectiveValuesByEnvironment(
  feature: FeatureInterface,
  environments: string[],
  experimentMap: Map<string, ExperimentInterface>,
  safeRolloutMap: Map<string, SafeRolloutInterface>,
): Record<string, { value: string | null }> {
  const environmentsObj: Record<string, { value: string | null }> = {};

  for (const envId of environments) {
    const effectiveValue = getEffectiveValueForEnvironment(
      feature,
      envId,
      experimentMap,
      safeRolloutMap,
    );
    environmentsObj[envId] = { value: effectiveValue };
  }

  return environmentsObj;
}

export const getStaleFeatures = createApiRequestHandler(
  getStaleFeaturesValidator,
)(async (req): Promise<GetStaleFeaturesResponse> => {
  const { flagIds, projectId } = req.query;

  const allFeatures = await getAllFeatures(req.context, {
    projects: projectId ? [projectId] : undefined,
    includeArchived: true,
  });

  let featuresToCheck = allFeatures;
  if (flagIds && flagIds.length > 0) {
    const featureIdSet = new Set(flagIds);
    featuresToCheck = allFeatures.filter((f) => featureIdSet.has(f.id));
  }

  const allExperiments = await getAllExperiments(req.context, {
    project: projectId,
    includeArchived: true,
  });

  const experimentMap = new Map(allExperiments.map((exp) => [exp.id, exp]));

  const experiments =
    allExperiments as unknown as ExperimentInterfaceStringDates[];

  const safeRolloutMap =
    await req.context.models.safeRollout.getAllPayloadSafeRollouts();

  const environments =
    req.organization.settings?.environments?.map((e) => e.id) || [];

  const sortedFeatures = featuresToCheck.sort(
    (a, b) => a.dateUpdated.getTime() - b.dateUpdated.getTime(),
  );

  const filteredResults = sortedFeatures
    .map((feature) => {
      const { stale } = isFeatureStale({
        feature,
        features: allFeatures,
        experiments,
        environments,
      });
      return { feature, stale };
    })
    .filter(({ feature, stale }) => stale || feature.archived)
    .map(({ feature }) => {
      const environmentsObj = getEffectiveValuesByEnvironment(
        feature,
        environments,
        experimentMap,
        safeRolloutMap,
      );

      return {
        id: feature.id,
        owner: feature.owner,
        archived: feature.archived || false,
        dateCreated: feature.dateCreated.toISOString(),
        dateUpdated: feature.dateUpdated.toISOString(),
        valueType: feature.valueType,
        customFields: feature.customFields ?? {},
        environments: environmentsObj,
      };
    });

  // TODO: Move sorting/limiting to the database query for better performance
  const { filtered, returnFields } = applyPagination(
    filteredResults,
    req.query,
  );

  return {
    features: filtered,
    ...returnFields,
  };
});
