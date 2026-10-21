import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentReportVariation } from "shared/types/report";
import Link from "@/ui/Link";
import track from "@/services/track";
import {
  ClusterReliabilityWarnings,
  useClusterReliabilityHealth,
} from "@/components/HealthTab/ClusterReliabilityCard";
import { ExperimentTab } from "./TabbedPage";

export default function ClusterReliabilityWarning({
  snapshot,
  variations,
  setTab,
}: {
  snapshot?: ExperimentSnapshotInterface;
  variations: ExperimentReportVariation[];
  setTab?: (tab: ExperimentTab) => void;
}) {
  const settings = snapshot?.settings;
  const clusterIdentifier = settings?.exposureQueryIdentifierType;
  const subUnitIdentifier = settings?.clusterSubUnitIdentifier;
  const isCluster =
    !!settings?.isClusterExperiment &&
    !!clusterIdentifier &&
    !!subUnitIdentifier;

  const health = useClusterReliabilityHealth(
    isCluster ? snapshot?.health?.clusterTraffic : undefined,
    isCluster ? snapshot?.health?.clusterUnits : undefined,
  );

  if (!isCluster || health.status !== "unhealthy") {
    return null;
  }

  return (
    <ClusterReliabilityWarnings
      health={health}
      variations={variations}
      clusterIdentifier={clusterIdentifier}
      subUnitIdentifier={subUnitIdentifier}
      footer={
        setTab ? (
          <>
            {" "}
            See the{" "}
            <Link
              onClick={() => {
                track("Open health tab", {
                  source: "results-tab-cluster-reliability-warning",
                });
                setTab("health");
              }}
            >
              health tab
            </Link>{" "}
            for more details.
          </>
        ) : null
      }
    />
  );
}
