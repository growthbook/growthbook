import { ExperimentSnapshotTraffic } from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import { useEffect, useMemo } from "react";
import { getSRMHealthData } from "shared/health";
import {
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
} from "shared/constants";
import { CovariateImbalanceResult } from "shared/enterprise";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import { useUser } from "@/services/UserContext";
import {
  CovariateImbalanceMetricVariationTable,
  CovariateImbalanceMetricSummaryTable,
} from "@/components/Experiment/TabbedPage/CovariateImbalanceTable";
import { HealthTabConfigParams } from "@/components/Experiment/TabbedPage/HealthTabOnboardingModal";
import CovariateImbalanceWarning from "../Experiment/CovariateImbalanceWarning";
import { StatusBadge } from "./StatusBadge";
import { IssueValue } from "./IssueTags";

interface Props {
  covariateImbalanceResult: CovariateImbalanceResult | null;
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

export default function CovariateImbalanceCard({
  covariateImbalanceResult,
  traffic,
  variations,
  totalUsers,
  onNotify,
  dataSource: _dataSource,
  exposureQuery: _exposureQuery,
  healthTabConfigParams: _healthTabConfigParams,
  canConfigHealthTab: _canConfigHealthTab,
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

  const covariateImbalanceHealth = covariateImbalanceResult?.isImbalanced
    ? "unhealthy"
    : "healthy";
  useEffect(() => {
    if (covariateImbalanceHealth === "unhealthy") {
      onNotify &&
        onNotify({ label: "Covariate Imbalance", value: "balanceCheck" });
    }
  }, [covariateImbalanceHealth, onNotify]);

  const classes = !newDesign ? "appbox container-fluid my-4 pl-3 py-3" : "";
  const hideRightTable = hideDimensions;

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
      <div>
        <h2 className="d-inline">Covariate Imbalance Check</h2>{" "}
        {srmHealth !== "healthy" && (
          <StatusBadge status={covariateImbalanceHealth} />
        )}
        <p className="mt-1">
          Pre-experiment metric imbalances across control and treatment groups.
        </p>
        <hr className="mb-0"></hr>
        <div style={{ paddingTop: "10px" }}>
          {!hideRightTable && (
            <div className="mb-4">
              {CovariateImbalanceMetricSummaryTable(covariateImbalanceResult)}
            </div>
          )}
          <div className="row justify-content-start w-100 overflow-auto">
            <CovariateImbalanceMetricVariationTable
              covariateImbalanceResult={covariateImbalanceResult}
              variations={variations}
            />
          </div>
          <div>
            {covariateImbalanceHealth === "unhealthy" ? (
              <CovariateImbalanceWarning />
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
  );
}
