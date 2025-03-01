import { ExperimentSnapshotTraffic } from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { getSRMHealthData } from "shared/health";
import {
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
} from "shared/constants";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import { useUser } from "@/services/UserContext";
import VariationUsersTable from "@/components/Experiment/TabbedPage/VariationUsersTable";
import SRMWarning from "@/components/Experiment/SRMWarning";
import { HealthTabConfigParams } from "@/components/Experiment/TabbedPage/HealthTabOnboardingModal";
import { StatusBadge } from "./StatusBadge";
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
  canConfigHealthTab: boolean;
}

export const EXPERIMENT_DIMENSION_PREFIX = "dim_exp_";

// NB: If this is for a Bandit experiment, we should use BanditSRMCard
export default function SRMCard({
  traffic,
  variations,
  totalUsers,
  onNotify,
  dataSource,
  exposureQuery,
  healthTabConfigParams,
  canConfigHealthTab,
}: Props) {
  const { settings } = useUser();

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const srmHealth = useMemo(
    () =>
      getSRMHealthData({
        srm: traffic.overall.srm,
        srmThreshold,
        numOfVariations: variations.length,
        totalUsersCount: totalUsers,
        minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
      }),
    [traffic.overall.srm, srmThreshold, variations.length, totalUsers]
  );

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
    if (srmHealth === "unhealthy") {
      onNotify({ label: "Experiment Balance", value: "balanceCheck" });
    }
  }, [traffic, srmHealth, onNotify]);

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
            {srmHealth !== "healthy" && <StatusBadge status={srmHealth} />}
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
                {srmHealth !== "not-enough-traffic" ? (
                  <SRMWarning
                    srm={traffic.overall.srm}
                    variations={variations}
                    users={traffic.overall.variationUnits}
                    showWhenHealthy
                    isBandit={false}
                  />
                ) : (
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
            canConfigHealthTab={canConfigHealthTab}
            isBandit={false}
          />
        </div>
      </div>
    </div>
  );
}
