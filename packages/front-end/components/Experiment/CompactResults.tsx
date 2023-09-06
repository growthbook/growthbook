import React, { FC, useMemo } from "react";
import { MdSwapCalls } from "react-icons/md";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
} from "back-end/types/report";
import { ExperimentStatus, MetricOverride } from "back-end/types/experiment";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import Link from "next/link";
import {FaAngleRight, FaTimes, FaUsers} from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  setAdjustedPValuesOnResults,
  ExperimentTableRow,
  useRiskVariation,
} from "@/services/experiments";
import { GBCuped } from "@/components/Icons";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import Tooltip from "../Tooltip/Tooltip";
import MetricTooltipBody from "../Metrics/MetricTooltipBody";
import DataQualityWarning from "./DataQualityWarning";
import ResultsTable from "./ResultsTable";
import MultipleExposureWarning from "./MultipleExposureWarning";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Collapsible from "react-collapsible";

const numberFormatter = Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

const CompactResults: FC<{
  editMetrics?: () => void;
  variations: ExperimentReportVariation[];
  variationFilter?: number[];
  baselineRow?: number;
  multipleExposures?: number;
  results: ExperimentReportResultDimension;
  queryStatusData?: QueryStatusData;
  reportDate: Date;
  startDate: string;
  isLatestPhase: boolean;
  status: ExperimentStatus;
  metrics: string[];
  metricOverrides: MetricOverride[];
  guardrails?: string[];
  id: string;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  regressionAdjustmentEnabled?: boolean;
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[];
  sequentialTestingEnabled?: boolean;
  isTabActive: boolean;
}> = ({
  editMetrics,
  variations,
  variationFilter,
  baselineRow = 0,
  multipleExposures = 0,
  results,
  queryStatusData,
  reportDate,
  startDate,
  isLatestPhase,
  status,
  metrics,
  metricOverrides,
  guardrails = [],
  id,
  statsEngine,
  pValueCorrection,
  regressionAdjustmentEnabled,
  metricRegressionAdjustmentStatuses,
  sequentialTestingEnabled,
  isTabActive,
}) => {
  const { getMetricById, ready } = useDefinitions();

  const [totalUsers, variationUsers] = useMemo(() => {
    let totalUsers = 0;
    const variationUsers: number[] = [];
    results?.variations?.forEach((v, i) => {
      totalUsers += v.users;
      variationUsers[i] = variationUsers[i] || 0;
      variationUsers[i] += v.users;
    });
    return [totalUsers, variationUsers];
  }, [results]);

  const rows = useMemo<ExperimentTableRow[]>(() => {
    function getRow(metricId: string, isGuardrail: boolean) {
      const metric = getMetricById(metricId);
      if (!metric) return null;
      const { newMetric, overrideFields } = applyMetricOverrides(
        metric,
        metricOverrides
      );
      let regressionAdjustmentStatus:
        | MetricRegressionAdjustmentStatus
        | undefined;
      if (regressionAdjustmentEnabled && metricRegressionAdjustmentStatuses) {
        regressionAdjustmentStatus = metricRegressionAdjustmentStatuses.find(
          (s) => s.metric === metricId
        );
      }
      return {
        label: newMetric?.name,
        metric: newMetric,
        metricOverrideFields: overrideFields,
        rowClass: newMetric?.inverse ? "inverse" : "",
        variations: results.variations.map((v) => {
          return v.metrics[metricId];
        }),
        regressionAdjustmentStatus,
        isGuardrail,
      };
    }

    if (!results || !results.variations || !ready) return [];
    if (pValueCorrection && statsEngine === "frequentist") {
      setAdjustedPValuesOnResults([results], metrics, pValueCorrection);
    }
    const retMetrics = metrics
      .map((metricId) => getRow(metricId, false))
      .filter((row) => row?.metric) as ExperimentTableRow[];
    const retGuardrails = guardrails
      .map((metricId) => getRow(metricId, true))
      .filter((row) => row?.metric) as ExperimentTableRow[];
    return [...retMetrics, ...retGuardrails];
  }, [
    results,
    metrics,
    guardrails,
    metricOverrides,
    regressionAdjustmentEnabled,
    metricRegressionAdjustmentStatuses,
    pValueCorrection,
    ready,
    getMetricById,
    statsEngine,
  ]);

  const users = useMemo(() => {
    const vars = results?.variations;
    return variations.map((v, i) => vars?.[i]?.users || 0);
  }, [results, variations]);
  const risk = useRiskVariation(variations.length, rows);

  return (
    <>
      {status !== "draft" && totalUsers > 0 && (
        <div className="users">
          <Collapsible
            trigger={
              <div className="d-inline-flex mx-3 align-items-center">
                <FaUsers size={16} className="mr-1" />
                {numberFormatter.format(totalUsers)}{" "}
                users
                <FaAngleRight className="chevron ml-1" />
              </div>
            }
            transitionTime={100}
          >
            <table className="table mx-2 mt-0 mb-3"
                   style={{ width: 300 }}
            >
              <thead>
              <tr>
                <th className="border-top-0">Variation</th>
                <th className="border-top-0">Users</th>
              </tr>
              </thead>
              <tbody>
              {variations.map((v, i) => (
                <tr key={i}>
                  <td
                    className={`variation with-variation-label variation${i}`}
                  >
                    <div className="d-flex align-items-center">
                                <span
                                  className="label"
                                  style={{
                                    width: 20,
                                    height: 20,
                                  }}
                                >
                                  {i}
                                </span>{" "}
                      <OverflowText
                        maxWidth={180}
                        title={v.name}
                      >
                        {v.name}
                      </OverflowText>
                    </div>
                  </td>
                  <td>
                    {numberFormatter.format(
                      variationUsers[i] || 0
                    )}
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </Collapsible>
        </div>
      )}

      <div className="mx-3">
        <DataQualityWarning results={results} variations={variations} />
        <MultipleExposureWarning
          users={users}
          multipleExposures={multipleExposures}
        />
      </div>
      <ResultsTable
        dateCreated={reportDate}
        isLatestPhase={isLatestPhase}
        startDate={startDate}
        status={status}
        queryStatusData={queryStatusData}
        variations={variations}
        variationFilter={variationFilter}
        baselineRow={baselineRow}
        rows={rows.filter((r) => !r.isGuardrail)}
        id={id}
        hasRisk={risk.hasRisk}
        tableRowAxis="metric"
        labelHeader="Goal Metrics"
        editMetrics={editMetrics}
        statsEngine={statsEngine}
        sequentialTestingEnabled={sequentialTestingEnabled}
        pValueCorrection={pValueCorrection}
        renderLabelColumn={getRenderLabelColumn(regressionAdjustmentEnabled)}
        isTabActive={isTabActive}
      />

      {guardrails.length ? (
        <div className="mt-4">
          <ResultsTable
            dateCreated={reportDate}
            isLatestPhase={isLatestPhase}
            startDate={startDate}
            status={status}
            queryStatusData={queryStatusData}
            variations={variations}
            variationFilter={variationFilter}
            baselineRow={baselineRow}
            rows={rows.filter((r) => r.isGuardrail)}
            id={id}
            hasRisk={risk.hasRisk}
            tableRowAxis="metric"
            labelHeader="Guardrail Metrics"
            editMetrics={editMetrics}
            metricsAsGuardrails={true}
            statsEngine={statsEngine}
            sequentialTestingEnabled={sequentialTestingEnabled}
            pValueCorrection={pValueCorrection}
            renderLabelColumn={getRenderLabelColumn(
              regressionAdjustmentEnabled
            )}
            isTabActive={isTabActive}
          />
        </div>
      ) : (
        <></>
      )}
    </>
  );
};
export default CompactResults;

export function getRenderLabelColumn(regressionAdjustmentEnabled) {
  return function renderLabelColumn(
    label: string,
    metric: MetricInterface,
    row: ExperimentTableRow,
    maxRows?: number
  ) {
    const metricLink = (
      <Tooltip
        body={
          <MetricTooltipBody
            metric={metric}
            row={row}
            reportRegressionAdjustmentEnabled={regressionAdjustmentEnabled}
            newUi={true}
          />
        }
        tipPosition="right"
        className="d-inline-block font-weight-bold metric-label"
        usePortal={true}
      >
        {" "}
        <span
          style={
            maxRows
              ? {
                  display: "-webkit-box",
                  WebkitLineClamp: maxRows,
                  WebkitBoxOrient: "vertical",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  lineHeight: "1.2em",
                }
              : {}
          }
        >
          <Link href={`/metric/${metric.id}`}>
            <a className="metriclabel text-dark">{label}</a>
          </Link>
        </span>
      </Tooltip>
    );

    const cupedIconDisplay =
      regressionAdjustmentEnabled &&
      !row?.regressionAdjustmentStatus?.regressionAdjustmentEnabled ? (
        <Tooltip
          className="ml-1"
          body={
            row?.regressionAdjustmentStatus?.reason
              ? `CUPED disabled: ${row?.regressionAdjustmentStatus?.reason}`
              : `CUPED disabled`
          }
        >
          <div
            className="d-inline-block mr-1 position-relative"
            style={{ width: 12, height: 12 }}
          >
            <GBCuped className="position-absolute" size={12} />
            <FaTimes
              className="position-absolute"
              color="#ff0000"
              style={{ transform: "scale(0.7)", top: -4, right: -8 }}
            />
          </div>
        </Tooltip>
      ) : null;

    const metricInverseIconDisplay = metric.inverse ? (
      <Tooltip
        body="metric is inverse, lower is better"
        className="inverse-indicator ml-1"
      >
        <MdSwapCalls />
      </Tooltip>
    ) : null;

    return (
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        {metricLink}
        {metricInverseIconDisplay}
        {cupedIconDisplay}
      </span>
    );
  };
}
