import { useMemo } from "react";
import { getClusterReliabilityHealthData } from "shared/health";
import {
  DEFAULT_MAX_CLUSTER_SHARE,
  DEFAULT_MIN_CLUSTERS_PER_VARIATION,
} from "shared/constants";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentReportVariation } from "shared/types/report";
import Callout from "@/ui/Callout";
import { IdentifierCode } from "@/components/Experiment/AssignmentQueryFields";

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

export default function ClusterReliabilityWarning({
  snapshot,
  variations,
}: {
  snapshot?: ExperimentSnapshotInterface;
  variations: ExperimentReportVariation[];
}) {
  const settings = snapshot?.settings;
  const clusterIdentifier = settings?.exposureQueryIdentifierType;
  const subUnitIdentifier = settings?.clusterSubUnitIdentifier;
  const isCluster =
    !!settings?.isClusterExperiment &&
    !!clusterIdentifier &&
    !!subUnitIdentifier;
  const clusterTraffic = isCluster
    ? snapshot?.health?.clusterTraffic
    : undefined;
  const clusterUnits = isCluster ? snapshot?.health?.clusterUnits : undefined;

  const health = useMemo(
    () =>
      getClusterReliabilityHealthData({
        clusterTraffic,
        clusterUnits,
        minClustersPerVariation: DEFAULT_MIN_CLUSTERS_PER_VARIATION,
        maxClusterShare: DEFAULT_MAX_CLUSTER_SHARE,
      }),
    [clusterTraffic, clusterUnits],
  );

  if (!isCluster || health.status !== "unhealthy") {
    return null;
  }

  const cluster = <IdentifierCode>{clusterIdentifier}</IdentifierCode>;
  const { tooFewClusters, oversizedCluster } = health;

  return (
    <>
      {tooFewClusters ? (
        <Callout status="warning">
          <strong>Cluster Reliability Warning</strong>.{" "}
          {variations[tooFewClusters.variationIndex]?.name ??
            `Variation ${tooFewClusters.variationIndex}`}{" "}
          has only {numberFormatter.format(tooFewClusters.count)} {cluster}{" "}
          {tooFewClusters.count === 1 ? "value" : "values"}, and at least{" "}
          {numberFormatter.format(DEFAULT_MIN_CLUSTERS_PER_VARIATION)} per
          variation is recommended. With this few, a single unusual {cluster}{" "}
          can swing the result.
        </Callout>
      ) : null}
      {oversizedCluster ? (
        <Callout status="warning">
          <strong>Cluster Size Warning</strong>.{" "}
          <IdentifierCode>{oversizedCluster.id}</IdentifierCode> holds{" "}
          {percentFormatter.format(oversizedCluster.pct)} of{" "}
          <IdentifierCode>{subUnitIdentifier}</IdentifierCode> values, and no
          single {cluster} should hold{" "}
          {percentFormatter.format(DEFAULT_MAX_CLUSTER_SHARE)} or more. That one{" "}
          {cluster} can drive most of the result.
        </Callout>
      ) : null}
    </>
  );
}
