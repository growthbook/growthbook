import { useEffect, useMemo } from "react";
import { getClusterCountHealthData } from "shared/health";
import { DEFAULT_MIN_CLUSTERS_PER_VARIATION } from "shared/constants";
import { ExperimentSnapshotTraffic } from "shared/types/experiment-snapshot";
import Callout from "@/ui/Callout";
import { IdentifierCode } from "@/components/Experiment/AssignmentQueryFields";
import { CardFrame } from "./ClusterIssueCard";
import { IssueValue } from "./IssueTags";

const numberFormatter = new Intl.NumberFormat();

interface Props {
  clusterTraffic: ExperimentSnapshotTraffic;
  variations: { name: string }[];
  clusterIdentifier: string;
  onNotify?: (issue: IssueValue) => void;
}

export default function ClusterReliabilityCard({
  clusterTraffic,
  variations,
  clusterIdentifier,
  onNotify,
}: Props) {
  const clustersPerVariation = clusterTraffic.overall?.variationUnits;

  const health = useMemo(
    () =>
      getClusterCountHealthData({
        clustersPerVariation: clustersPerVariation ?? [],
        minClustersPerVariation: DEFAULT_MIN_CLUSTERS_PER_VARIATION,
      }),
    [clustersPerVariation],
  );

  useEffect(() => {
    if (health.status === "unhealthy" && onNotify) {
      onNotify({
        label: "Cluster Reliability Check",
        value: "clusterReliability",
      });
    }
  }, [health, onNotify]);

  if (clusterTraffic.error || health.status === "not-enough-traffic") {
    return null;
  }

  const cluster = <IdentifierCode>{clusterIdentifier}</IdentifierCode>;
  const minimum = numberFormatter.format(DEFAULT_MIN_CLUSTERS_PER_VARIATION);
  const smallestName =
    variations[health.smallestVariationIndex]?.name ??
    `Variation ${health.smallestVariationIndex}`;

  return (
    <CardFrame
      title="Cluster Reliability Check"
      description={
        <>
          Detects whether every variation has enough {cluster} values for
          reliable results
        </>
      }
      status={health.status}
    >
      {health.status === "unhealthy" ? (
        <Callout status="warning">
          <strong>Cluster Reliability Warning</strong>. {smallestName} has only{" "}
          {numberFormatter.format(health.smallestCount)} {cluster}{" "}
          {health.smallestCount === 1 ? "value" : "values"}, and at least{" "}
          {minimum} per variation is recommended. With this few, a single
          unusual {cluster} can swing the result.
        </Callout>
      ) : (
        <Callout status="success">
          <b>
            Every variation has at least {minimum} {cluster} values.
          </b>
        </Callout>
      )}
    </CardFrame>
  );
}
