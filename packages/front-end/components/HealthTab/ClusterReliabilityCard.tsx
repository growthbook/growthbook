import { useEffect, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { getClusterCountHealthData } from "shared/health";
import {
  DEFAULT_MAX_CLUSTER_SHARE,
  DEFAULT_MIN_CLUSTERS_PER_VARIATION,
} from "shared/constants";
import {
  ExperimentSnapshotClusterUnits,
  ExperimentSnapshotTraffic,
} from "shared/types/experiment-snapshot";
import Callout from "@/ui/Callout";
import { IdentifierCode } from "@/components/Experiment/AssignmentQueryFields";
import { CardFrame } from "./ClusterIssueCard";
import { IssueValue } from "./IssueTags";

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

interface Props {
  clusterTraffic: ExperimentSnapshotTraffic;
  clusterUnits?: ExperimentSnapshotClusterUnits;
  variations: { name: string }[];
  clusterIdentifier: string;
  subUnitIdentifier: string;
  onNotify?: (issue: IssueValue) => void;
}

export default function ClusterReliabilityCard({
  clusterTraffic,
  clusterUnits,
  variations,
  clusterIdentifier,
  subUnitIdentifier,
  onNotify,
}: Props) {
  const clustersPerVariation = clusterTraffic.error
    ? undefined
    : clusterTraffic.overall?.variationUnits;

  const countHealth = useMemo(
    () =>
      getClusterCountHealthData({
        clustersPerVariation: clustersPerVariation ?? [],
        minClustersPerVariation: DEFAULT_MIN_CLUSTERS_PER_VARIATION,
      }),
    [clustersPerVariation],
  );

  const largestCluster = useMemo(() => {
    if (clusterUnits?.error || !clusterUnits?.clusters.length) return null;
    return clusterUnits.clusters.reduce((a, b) => (b.pct > a.pct ? b : a));
  }, [clusterUnits]);

  const totalClusters = (clustersPerVariation ?? []).reduce(
    (sum, n) => sum + n,
    0,
  );
  // With 1 / share clusters or fewer, one always reaches the share.
  const canCheckSize =
    totalClusters > Math.floor(1 / DEFAULT_MAX_CLUSTER_SHARE);

  const tooFewClusters = countHealth.status === "unhealthy";
  const sizeChecked = canCheckSize && !!largestCluster;
  const oversizedCluster =
    sizeChecked && largestCluster.pct >= DEFAULT_MAX_CLUSTER_SHARE;
  const status =
    tooFewClusters || oversizedCluster
      ? "unhealthy"
      : countHealth.status === "healthy" || sizeChecked
        ? "healthy"
        : "not-enough-traffic";

  useEffect(() => {
    if (status === "unhealthy" && onNotify) {
      onNotify({
        label: "Cluster Reliability Check",
        value: "clusterReliability",
      });
    }
  }, [status, onNotify]);

  if (status === "not-enough-traffic") {
    return null;
  }

  const cluster = <IdentifierCode>{clusterIdentifier}</IdentifierCode>;
  const subUnit = <IdentifierCode>{subUnitIdentifier}</IdentifierCode>;
  const minimum = numberFormatter.format(DEFAULT_MIN_CLUSTERS_PER_VARIATION);
  const maxShare = percentFormatter.format(DEFAULT_MAX_CLUSTER_SHARE);
  const smallestName =
    variations[countHealth.smallestVariationIndex]?.name ??
    `Variation ${countHealth.smallestVariationIndex}`;

  return (
    <CardFrame
      title="Cluster Reliability Check"
      description={
        <>
          Detects whether every variation has enough {cluster} values, and
          whether one {cluster} holds too many {subUnit} values, for reliable
          results
        </>
      }
      status={status}
    >
      <Flex direction="column" gap="3">
        {tooFewClusters ? (
          <Callout status="warning">
            <strong>Cluster Reliability Warning</strong>. {smallestName} has
            only {numberFormatter.format(countHealth.smallestCount)} {cluster}{" "}
            {countHealth.smallestCount === 1 ? "value" : "values"}, and at least{" "}
            {minimum} per variation is recommended. With this few, a single
            unusual {cluster} can swing the result.
          </Callout>
        ) : null}
        {oversizedCluster ? (
          <Callout status="warning">
            <strong>Cluster Size Warning</strong>.{" "}
            <IdentifierCode>{largestCluster.id}</IdentifierCode> holds{" "}
            {percentFormatter.format(largestCluster.pct)} of {subUnit} values,
            and no single {cluster} should hold {maxShare} or more. That one{" "}
            {cluster} can drive most of the result.
          </Callout>
        ) : null}
        {status === "healthy" ? (
          <Callout status="success">
            <b>
              {countHealth.status === "healthy" ? (
                <>
                  Every variation has at least {minimum} {cluster} values
                </>
              ) : null}
              {countHealth.status === "healthy" && sizeChecked ? ", and " : ""}
              {sizeChecked ? (
                <>
                  {countHealth.status === "healthy" ? "no" : "No"} {cluster}{" "}
                  holds {maxShare} or more of {subUnit} values
                </>
              ) : null}
              .
            </b>
          </Callout>
        ) : null}
      </Flex>
    </CardFrame>
  );
}
