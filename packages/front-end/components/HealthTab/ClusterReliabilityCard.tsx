import { ReactNode, useEffect, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { getClusterReliabilityHealthData } from "shared/health";
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
const minimum = numberFormatter.format(DEFAULT_MIN_CLUSTERS_PER_VARIATION);
const maxShare = percentFormatter.format(DEFAULT_MAX_CLUSTER_SHARE);

export function useClusterReliabilityHealth(
  clusterTraffic: ExperimentSnapshotTraffic | undefined,
  clusterUnits: ExperimentSnapshotClusterUnits | undefined,
) {
  return useMemo(
    () =>
      getClusterReliabilityHealthData({
        clusterTraffic,
        clusterUnits,
        minClustersPerVariation: DEFAULT_MIN_CLUSTERS_PER_VARIATION,
        maxClusterShare: DEFAULT_MAX_CLUSTER_SHARE,
      }),
    [clusterTraffic, clusterUnits],
  );
}

// The warning callouts, shared by the Health tab card and the Results tab.
export function ClusterReliabilityWarnings({
  health,
  variations,
  clusterIdentifier,
  subUnitIdentifier,
  footer,
}: {
  health: ReturnType<typeof getClusterReliabilityHealthData>;
  variations: { name: string }[];
  clusterIdentifier: string;
  subUnitIdentifier: string;
  footer?: ReactNode;
}) {
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
          {minimum} per variation is recommended. With this few, a single
          unusual {cluster} can swing the result.
          {footer}
        </Callout>
      ) : null}
      {oversizedCluster ? (
        <Callout status="warning">
          <strong>Cluster Size Warning</strong>.{" "}
          <IdentifierCode>{oversizedCluster.id}</IdentifierCode> holds{" "}
          {percentFormatter.format(oversizedCluster.pct)} of{" "}
          <IdentifierCode>{subUnitIdentifier}</IdentifierCode> values, and no
          single {cluster} should hold {maxShare} or more. That one {cluster}{" "}
          can drive most of the result.
          {footer}
        </Callout>
      ) : null}
    </>
  );
}

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
  const health = useClusterReliabilityHealth(clusterTraffic, clusterUnits);

  useEffect(() => {
    if (health.status === "unhealthy" && onNotify) {
      onNotify({
        label: "Cluster Reliability Check",
        value: "clusterReliability",
      });
    }
  }, [health.status, onNotify]);

  if (health.status === "not-enough-traffic") {
    return null;
  }

  const cluster = <IdentifierCode>{clusterIdentifier}</IdentifierCode>;
  const subUnit = <IdentifierCode>{subUnitIdentifier}</IdentifierCode>;
  const { countChecked, sizeChecked } = health;

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
      status={health.status}
    >
      <Flex direction="column" gap="3">
        <ClusterReliabilityWarnings
          health={health}
          variations={variations}
          clusterIdentifier={clusterIdentifier}
          subUnitIdentifier={subUnitIdentifier}
        />
        {health.status === "healthy" ? (
          <Callout status="success">
            <b>
              {countChecked ? (
                <>
                  Every variation has at least {minimum} {cluster} values
                </>
              ) : null}
              {countChecked && sizeChecked ? ", and " : ""}
              {sizeChecked ? (
                <>
                  {countChecked ? "no" : "No"} {cluster} holds {maxShare} or
                  more of {subUnit} values
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
