import { ExperimentSnapshotTraffic } from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import { useEffect, useRef, useState } from "react";
import { useUser } from "@/services/UserContext";
import { pValueFormatter } from "@/services/experiments";
import { DEFAULT_SRM_THRESHOLD } from "@/pages/settings";
import track from "@/services/track";
import VariationUsersTable from "../Experiment/TabbedPage/VariationUsersTable";
import SRMWarning from "../Experiment/SRMWarning";
import { DataPointVariation } from "../Experiment/ExperimentDateGraph";
import { HealthStatus, StatusBadge } from "./StatusBadge";
import { DimensionIssues } from "./DimensionIssues";

interface Props {
  traffic: ExperimentSnapshotTraffic;
  variations: ExperimentReportVariation[];
  totalUsers: number;
  datasource: string;
  onNotify: () => void;
}

export const srmHealthCheck = ({
  srm,
  variations,
  srmThreshold,
  totalUsers,
}: {
  srm: number;
  variations: ExperimentReportVariation[] | DataPointVariation[];
  srmThreshold: number;
  totalUsers: number;
}): HealthStatus => {
  if (totalUsers && totalUsers < 8 * variations.length) {
    return "Not enough traffic";
  } else if (srm >= srmThreshold) {
    return "healthy";
  }
  return "Issues detected";
};

export const EXPERIMENT_DIMENSION_PREFIX = "dim_exp_";
const NOT_ENOUGH_DATA_TOOLTIP_MESSAGE =
  "Not enough data to compute balance check.";

export default function SRMDrawer({
  traffic,
  variations,
  totalUsers,
  datasource,
  onNotify,
}: Props) {
  const [selectedDimension, setSelectedDimension] = useState<string>("");
  const { settings } = useUser();
  const balanceCheckTableRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Set the height of the parent based on the height of the specific child
    if (balanceCheckTableRef.current) {
      const childHeight = balanceCheckTableRef.current.clientHeight;

      const parentElement = document.getElementById("parent-container");
      if (parentElement) {
        // Perform a null check before accessing properties or methods on the result
        const newParentHeight = childHeight; // 20px padding, adjust as needed
        parentElement.style.height = `${newParentHeight}px`;
      }
    }
  }, []);

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const overallHealth: HealthStatus = srmHealthCheck({
    srm: traffic.overall.srm,
    srmThreshold,
    variations,
    totalUsers,
  });

  useEffect(() => {
    if (overallHealth === "Issues detected") {
      onNotify();
    }
  }, [overallHealth, onNotify]);

  useEffect(() => {
    setSelectedDimension("");
  }, [traffic]);

  return (
    <div className="appbox my-4 p-3">
      <div className="row overflow-hidden" id="parent-container">
        <div className="col-8 border-right pr-4">
          <div ref={balanceCheckTableRef}>
            <h2 className="d-inline">Experiment Balance Check</h2>{" "}
            {/* <p className="d-inline text-muted">{helpText}</p> */}
            {overallHealth && overallHealth !== "healthy" && (
              <StatusBadge status={overallHealth} />
            )}
            <p className="mt-1">
              Shows actual unit split compared to percent selected for the
              experiment
            </p>
            <hr></hr>
            <div>
              <div className="row justify-content-start w-100">
                <VariationUsersTable
                  users={traffic.overall.variationUnits}
                  variations={variations}
                  srm={pValueFormatter(traffic.overall.srm)}
                  isUnhealthy={overallHealth === "Issues detected"}
                />
              </div>
              <div>
                {overallHealth === "healthy" && (
                  <div className="alert alert-info">
                    <b>
                      No Sample Ratio Mismatch (SRM) detected. p-value above{" "}
                      {srmThreshold}
                    </b>
                    <div>
                      <a href="#">Learn More {">"}</a>
                    </div>
                  </div>
                )}
                {overallHealth === "Issues detected" && (
                  <SRMWarning
                    srm={traffic.overall.srm}
                    expected={variations.map((v) => v.weight)}
                    observed={traffic.overall.variationUnits}
                  />
                )}
                {overallHealth === "Not enough traffic" && (
                  <div className="alert alert-info">
                    {NOT_ENOUGH_DATA_TOOLTIP_MESSAGE}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="col h-100 w-100">
          <DimensionIssues
            dimensionData={traffic.dimension}
            variations={variations}
          />
        </div>
      </div>
    </div>
  );
}
