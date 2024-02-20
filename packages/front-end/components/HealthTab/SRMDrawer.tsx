import { ExperimentSnapshotTraffic } from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import { useEffect, useLayoutEffect } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import { useUser } from "@/services/UserContext";
import { DEFAULT_SRM_THRESHOLD } from "@/pages/settings";
import VariationUsersTable from "@/components/Experiment/TabbedPage/VariationUsersTable";
import SRMWarning from "@/components/Experiment/SRMWarning";
import { DataPointVariation } from "@/components/Experiment/ExperimentDateGraph";
import { HealthTabConfigParams } from "@/components/Experiment/TabbedPage/HealthTabOnboardingModal";
import { HealthStatus, StatusBadge } from "./StatusBadge";
import { DimensionIssues } from "./DimensionIssues";
import { IssueValue } from "./IssueTags";

interface Props {
  traffic: ExperimentSnapshotTraffic;
  variations: ExperimentReportVariation[];
  totalUsers: number;
  onNotify: (issue: IssueValue) => void;
  dataSource: DataSourceInterfaceWithParams | null;
  exposureQuery?: ExposureQuery;
  healthTabConfigParams: HealthTabConfigParams;
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

export default function SRMDrawer({
  traffic,
  variations,
  totalUsers,
  onNotify,
  dataSource,
  exposureQuery,
  healthTabConfigParams,
}: Props) {
  const { settings } = useUser();

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const overallHealth: HealthStatus = srmHealthCheck({
    srm: traffic.overall.srm,
    srmThreshold,
    variations,
    totalUsers,
  });

  function onResize() {
    const childHeight = document.getElementById("child-container")
      ?.clientHeight;
    const parentElement = document.getElementById("parent-container");

    parentElement && (parentElement.style.height = `${childHeight}px`);
  }

  useEffect(() => {
    window.addEventListener("resize", onResize, false);
    return () => window.removeEventListener("resize", onResize, false);
  }, []);
  useLayoutEffect(onResize, []);

  useEffect(() => {
    if (overallHealth === "Issues detected") {
      onNotify({ label: "Experiment Balance", value: "balanceCheck" });
    }
  }, [traffic, overallHealth, onNotify]);

  if (!traffic?.overall?.variationUnits?.length) {
    return (
      <div className="appbox my-4 p-3">
        <div className="alert alert-danger">Traffic data is missing</div>
      </div>
    );
  }

  return (
    <div className="appbox container-fluid my-4 pl-3 py-3">
      <div className="row overflow-hidden" id="parent-container">
        <div className="col-8 border-right pr-4">
          <div
            className="overflow-auto"
            id="child-container"
            ref={(node) => {
              if (node) {
                const childHeight = node.clientHeight;
                const parentElement = document.getElementById(
                  "parent-container"
                );

                parentElement &&
                  (parentElement.style.height = `${childHeight}px`);
              }
            }}
          >
            <h2 className="d-inline">Experiment Balance Check</h2>{" "}
            {/* <p className="d-inline text-muted">{helpText}</p> */}
            {overallHealth && overallHealth !== "healthy" && (
              <StatusBadge status={overallHealth} />
            )}
            <p className="mt-1">
              Shows actual unit split compared to percent selected for the
              experiment
            </p>
            <hr className="mb-0"></hr>
            <div style={{ paddingTop: "10px" }}>
              <div className="row justify-content-start w-100 overflow-auto">
                <VariationUsersTable
                  users={traffic.overall.variationUnits}
                  variations={variations}
                  srm={traffic.overall.srm}
                />
              </div>
              <div>
                {(overallHealth === "healthy" ||
                  overallHealth === "Issues detected") && (
                  <SRMWarning
                    srm={traffic.overall.srm}
                    variations={variations}
                    users={traffic.overall.variationUnits}
                    showWhenHealthy
                  />
                )}
                {overallHealth === "Not enough traffic" && (
                  <div className="alert alert-info">
                    <b>
                      More traffic is required to detect a Sample Ratio Mismatch
                      (SRM).
                    </b>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="col h-100 p-0 overflow-hidden">
          <DimensionIssues
            dimensionData={traffic.dimension}
            variations={variations}
            dataSource={dataSource}
            exposureQuery={exposureQuery}
            healthTabConfigParams={healthTabConfigParams}
          />
        </div>
      </div>
    </div>
  );
}
