import {
  DEFAULT_MAX_CLUSTER_SHARE,
  DEFAULT_MIN_CLUSTERS_PER_VARIATION,
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
} from "shared/constants";
import { getSrmAndMultipleExposuresHealth } from "shared/enterprise";
import {
  getBanditSRMValue,
  getClusterIssueHealthData,
  getClusterReliabilityHealthData,
  getExperimentSRMValue,
  getExperimentSRMVariationUnits,
  getExperimentVariationUnitsFromHealth,
} from "shared/health";
import { ApiExperimentResultHealth } from "shared/validators";
import {
  ExperimentHealthSettings,
  ExperimentInterface,
} from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";

function sumUnits(units: number[] | undefined): number | null {
  return units ? units.reduce((sum, n) => sum + n, 0) : null;
}

export function toApiResultHealth({
  experiment,
  snapshot,
  healthSettings,
}: {
  experiment: Pick<ExperimentInterface, "type" | "variations">;
  snapshot: ExperimentSnapshotInterface;
  healthSettings: ExperimentHealthSettings;
}): ApiExperimentResultHealth {
  const isBandit = experiment.type === "multi-armed-bandit";
  const isCluster = !!snapshot.settings.isClusterExperiment;
  const health = snapshot.health;

  const srmVariationUnits = getExperimentSRMVariationUnits(snapshot);
  const srmPValue = isBandit
    ? getBanditSRMValue(snapshot)
    : getExperimentSRMValue(snapshot);

  // Snapshots loaded through the model can carry empty objects for health
  // parts that were never computed, so each part is checked for real values.
  const subUnitExposures = health?.subUnitMultipleExposures;
  const { srm, multipleExposures } = getSrmAndMultipleExposuresHealth({
    // Only reported when there is a p-value, so the placeholder is never seen.
    srm: srmPValue ?? 1,
    multipleExposures: snapshot.multipleExposures ?? 0,
    totalUsers: sumUnits(getExperimentVariationUnitsFromHealth(snapshot)),
    srmTotalUnits: sumUnits(srmVariationUnits),
    subUnitMultipleExposures:
      subUnitExposures &&
      !subUnitExposures.error &&
      typeof subUnitExposures.totalSubUnits === "number"
        ? subUnitExposures
        : null,
    isClusterExperiment: isCluster,
    numOfVariations: snapshot.settings.variations.length,
    minUsersPerVariation: isBandit
      ? DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION
      : DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
    healthSettings,
  });

  const power = health?.power;
  const covariateImbalance = health?.covariateImbalance;

  return {
    srm:
      srmPValue === undefined
        ? null
        : {
            pValue: srmPValue,
            status: srm.status,
            threshold: healthSettings.srmThreshold,
            totalUnits: srm.totalUnits,
            variationUnits: srmVariationUnits ?? null,
          },
    multipleExposures: multipleExposures
      ? {
          count: multipleExposures.count,
          totalUnits: multipleExposures.totalUnits,
          percent: multipleExposures.rawDecimal,
          status: multipleExposures.status,
          threshold: healthSettings.multipleExposureMinPercent,
        }
      : null,
    unknownVariations: snapshot.unknownVariations ?? [],
    // A failed power calculation has no verdict, as in the app.
    power:
      power?.type === "success"
        ? {
            isLowPowered: power.isLowPowered,
            // Infinite when no treatment variation is getting new units.
            additionalDaysNeeded: Number.isFinite(power.additionalDaysNeeded)
              ? power.additionalDaysNeeded
              : null,
          }
        : null,
    covariateImbalance:
      typeof covariateImbalance?.isImbalanced === "boolean"
        ? {
            isImbalanced: covariateImbalance.isImbalanced,
            numGoalMetricsImbalanced:
              covariateImbalance.numGoalMetricsImbalanced,
            numGuardrailMetricsImbalanced:
              covariateImbalance.numGuardrailMetricsImbalanced,
            numSecondaryMetricsImbalanced:
              covariateImbalance.numSecondaryMetricsImbalanced,
          }
        : null,
    ...(isCluster
      ? {
          cluster: getApiClusterHealth({
            experiment,
            snapshot,
            healthSettings,
          }),
        }
      : {}),
  };
}

function getApiClusterHealth({
  experiment,
  snapshot,
  healthSettings,
}: {
  experiment: Pick<ExperimentInterface, "variations">;
  snapshot: ExperimentSnapshotInterface;
  healthSettings: ExperimentHealthSettings;
}): NonNullable<ApiExperimentResultHealth["cluster"]> {
  const health = snapshot.health;
  const clusterIssue = (affectedCount: number, totalCount: number) => {
    const { status, rawDecimal } = getClusterIssueHealthData({
      affectedCount,
      totalCount,
      minPercentThreshold: healthSettings.clusterIssueMinPercent,
    });
    return { percent: rawDecimal, status };
  };

  const clusterAssignment = health?.clusterAssignment;
  const mixedAssignment =
    clusterAssignment &&
    !clusterAssignment.error &&
    typeof clusterAssignment.totalClusters === "number"
      ? {
          totalClusters: clusterAssignment.totalClusters,
          mixedClusters: clusterAssignment.mixedClusters,
          ...clusterIssue(
            clusterAssignment.mixedClusters,
            clusterAssignment.totalClusters,
          ),
        }
      : null;

  const clusterMapping = health?.clusterSubUnitMapping;
  const unitsInMultipleClusters =
    clusterMapping &&
    !clusterMapping.error &&
    typeof clusterMapping.totalUnits === "number"
      ? {
          totalUnits: clusterMapping.totalUnits,
          multiClusterUnits: clusterMapping.multiClusterUnits,
          ...clusterIssue(
            clusterMapping.multiClusterUnits,
            clusterMapping.totalUnits,
          ),
        }
      : null;

  const clusterReliability = getClusterReliabilityHealthData({
    clusterTraffic: health?.clusterTraffic,
    clusterUnits: health?.clusterUnits,
    minClustersPerVariation: DEFAULT_MIN_CLUSTERS_PER_VARIATION,
    maxClusterShare: DEFAULT_MAX_CLUSTER_SHARE,
  });
  const { tooFewClusters, oversizedCluster } = clusterReliability;
  // Snapshots store the variation key; older ones stored the ID in its place.
  const toApiVariation = (variationIndex: number) => {
    const variationKey =
      snapshot.settings.variations[variationIndex]?.id ?? `${variationIndex}`;
    const variationId = (
      experiment.variations.find((v) => v.key === variationKey) ??
      experiment.variations.find((v) => v.id === variationKey)
    )?.id;
    return {
      variationIndex,
      variationKey,
      ...(variationId ? { variationId } : {}),
    };
  };
  const reliability =
    clusterReliability.status === "not-enough-traffic"
      ? null
      : {
          status: clusterReliability.status,
          minClustersPerVariation: DEFAULT_MIN_CLUSTERS_PER_VARIATION,
          maxClusterShare: DEFAULT_MAX_CLUSTER_SHARE,
          tooFewClusters: tooFewClusters
            ? {
                ...toApiVariation(tooFewClusters.variationIndex),
                clusters: tooFewClusters.count,
              }
            : null,
          oversizedCluster: oversizedCluster
            ? { id: oversizedCluster.id, percent: oversizedCluster.pct }
            : null,
        };

  return { mixedAssignment, unitsInMultipleClusters, reliability };
}
