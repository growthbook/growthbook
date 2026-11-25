import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
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
  const variationIndex = tooFewClusters?.variationIndex ?? 0;
  const variationName =
    variations[variationIndex]?.name ?? t`Variation ${variationIndex}`;
  const clusterCount = numberFormatter.format(tooFewClusters?.count ?? 0);
  const minClusters = numberFormatter.format(
    DEFAULT_MIN_CLUSTERS_PER_VARIATION,
  );
  const oversizedClusterId = oversizedCluster?.id;
  const oversizedPct = percentFormatter.format(oversizedCluster?.pct ?? 0);
  const maxShare = percentFormatter.format(DEFAULT_MAX_CLUSTER_SHARE);

  return (
    <Flex direction="column" gap="2" mx="3" mt="2">
      {tooFewClusters ? (
        <Callout status="warning">
          <Plural
            value={tooFewClusters.count}
            one={
              <>
                <strong>Cluster Reliability Warning</strong>. {variationName}{" "}
                has only {clusterCount} {cluster} value, and at least{" "}
                {minClusters} per variation is recommended. With this few, a
                single unusual {cluster} can swing the result.
              </>
            }
            other={
              <>
                <strong>Cluster Reliability Warning</strong>. {variationName}{" "}
                has only {clusterCount} {cluster} values, and at least{" "}
                {minClusters} per variation is recommended. With this few, a
                single unusual {cluster} can swing the result.
              </>
            }
          />
        </Callout>
      ) : null}
      {oversizedCluster ? (
        <Callout status="warning">
          <Trans>
            <strong>Cluster Size Warning</strong>.{" "}
            <IdentifierCode>{oversizedClusterId}</IdentifierCode> holds{" "}
            {oversizedPct} of{" "}
            <IdentifierCode>{subUnitIdentifier}</IdentifierCode> values, and no
            single {cluster} should hold {maxShare} or more. That one {cluster}{" "}
            can drive most of the result.
          </Trans>
        </Callout>
      ) : null}
    </Flex>
  );
}
