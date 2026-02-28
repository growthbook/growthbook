import { ExperimentSnapshotTraffic } from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import { useEffect } from "react";
import { CovariateImbalanceResult } from "shared/enterprise";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import {
  CovariateImbalanceMetricVariationTable,
  CovariateImbalanceMetricSummaryTable,
} from "@/components/Experiment/TabbedPage/CovariateImbalanceTable";
import { HealthTabConfigParams } from "@/components/Experiment/TabbedPage/HealthTabOnboardingModal";
import Callout from "@/ui/Callout";
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
  variations,
  onNotify,
  dataSource: _dataSource,
  exposureQuery: _exposureQuery,
  healthTabConfigParams: _healthTabConfigParams,
  canConfigHealthTab: _canConfigHealthTab,
  newDesign = false,
  hideDimensions: _hideDimensions = false,
}: Props) {
  const covariateImbalanceHealth = covariateImbalanceResult?.isImbalanced
    ? "unhealthy"
    : "healthy";

  useEffect(() => {
    if (covariateImbalanceHealth === "unhealthy" && onNotify) {
      onNotify({
        label: "Covariate Imbalance",
        value: "covariateBalanceCheck",
      });
    }
  }, [covariateImbalanceHealth, onNotify]);

  const classes = !newDesign ? "appbox container-fluid my-4 pl-3 py-3" : "";

  const numGoalMetricsTested = covariateImbalanceResult?.numGoalMetrics;

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
        {covariateImbalanceHealth !== "healthy" && (
          <StatusBadge status={covariateImbalanceHealth} />
        )}
        <p className="mt-1">
          Detects pre-experiment metric imbalances across control and treatment
          groups.
        </p>
        <hr className="mb-0"></hr>
        <div style={{ paddingTop: "10px" }}>
          {numGoalMetricsTested === 0 ? (
            <div className="ml-2 mr-2 mt-1 w-100">
              <Callout status="info" contentsAs="div">
                <b>No Goal Metrics had covariates tested.</b>
              </Callout>
            </div>
          ) : covariateImbalanceHealth === "healthy" ? (
            <div className="ml-2 mr-2 mt-1 w-100">
              <Callout status="info" contentsAs="div">
                <b>Covariate imbalances were not detected.</b>
              </Callout>
            </div>
          ) : (
            <>
              <div className="mb-4">
                {CovariateImbalanceMetricSummaryTable(covariateImbalanceResult)}
              </div>
              <div className="row justify-content-start w-100 overflow-auto">
                <CovariateImbalanceMetricVariationTable
                  covariateImbalanceResult={covariateImbalanceResult}
                  variations={variations}
                />
              </div>
              <div>
                <CovariateImbalanceWarning />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
