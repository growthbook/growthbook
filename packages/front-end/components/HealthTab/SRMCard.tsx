import { ExperimentSnapshotTraffic } from "shared/types/experiment-snapshot";
import { ExperimentReportVariation } from "shared/types/report";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { getSRMHealthData } from "shared/health";
import {
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
} from "shared/constants";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "shared/types/datasource";
import clsx from "clsx";
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
  onNotify?: (issue: IssueValue) => void;
  dataSource: DataSourceInterfaceWithParams | null;
  exposureQuery?: ExposureQuery;
  healthTabConfigParams?: HealthTabConfigParams;
  canConfigHealthTab: boolean;
  newDesign?: boolean;
  hideDimensions?: boolean;
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
  newDesign = false,
  hideDimensions = false,
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
    [traffic.overall.srm, srmThreshold, variations.length, totalUsers],
  );

  function onResize() {
    const childHeight =
      document.getElementById("child-container")?.clientHeight;
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
      onNotify &&
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

  const classes = !newDesign ? "appbox container-fluid my-4 pl-3 py-3" : "";

  return (
    <div
      className={classes}
      style={{
        ...(newDesign && {
          border: "1px solid var(--slate-a4)",
          borderRadius: "var(--radius-1)",
          padding: "var(--space-4) var(--space-3) 0",
        }),
      }}
    >
      <div
        className={clsx("overflow-hidden", { row: !hideDimensions })}
        id="parent-container"
      >
        <div className={clsx({ "col-8 border-right pr-4": !hideDimensions })}>
          <div
            className="overflow-auto"
            id="child-container"
            ref={(node) => {
              if (node) {
                const childHeight = node.clientHeight;
                const parentElement =
                  document.getElementById("parent-container");

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
        {!hideDimensions && (
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
        )}
      </div>
    </div>
  );
}
