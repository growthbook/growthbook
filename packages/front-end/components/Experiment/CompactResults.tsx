import React, { FC, useMemo } from "react";
import { MdSwapCalls } from "react-icons/md";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
} from "back-end/types/report";
import { ExperimentStatus, MetricOverride } from "back-end/types/experiment";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "back-end/types/stats";
import Link from "next/link";
import { FaAngleRight, FaTimes, FaUsers } from "react-icons/fa";
import Collapsible from "react-collapsible";
import { ExperimentMetricInterface, getMetricLink } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  setAdjustedPValuesOnResults,
  ExperimentTableRow,
  useRiskVariation,
  setAdjustedCIs,
} from "@/services/experiments";
import { GBCuped } from "@/components/Icons";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import {
  ResultsMetricFilters,
  sortAndFilterMetricsByTags,
} from "@/components/Experiment/Results";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import Tooltip from "../Tooltip/Tooltip";
import MetricTooltipBody from "../Metrics/MetricTooltipBody";
import FactBadge from "../FactTables/FactBadge";
import OfficialBadge from "../Metrics/OfficialBadge";
import DataQualityWarning from "./DataQualityWarning";
import ResultsTable from "./ResultsTable";
import MultipleExposureWarning from "./MultipleExposureWarning";
import VariationUsersTable from "./TabbedPage/VariationUsersTable";
import { ExperimentTab } from "./TabbedPage";

const numberFormatter = Intl.NumberFormat();

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
  differenceType: DifferenceType;
  metricFilter?: ResultsMetricFilters;
  setMetricFilter?: (filter: ResultsMetricFilters) => void;
  isTabActive: boolean;
  setTab?: (tab: ExperimentTab) => void;
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
  differenceType,
  metricFilter,
  setMetricFilter,
  isTabActive,
  setTab,
}) => {
  const { getExperimentMetricById, ready } = useDefinitions();
  const pValueThreshold = usePValueThreshold();

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

  const allMetricTags = useMemo(() => {
    const allMetricTagsSet: Set<string> = new Set();
    [...metrics, ...guardrails].forEach((metricId) => {
      const metric = getExperimentMetricById(metricId);
      metric?.tags?.forEach((tag) => {
        allMetricTagsSet.add(tag);
      });
    });
    return [...allMetricTagsSet];
  }, [metrics, guardrails, getExperimentMetricById]);

  const rows = useMemo<ExperimentTableRow[]>(() => {
    function getRow(metricId: string, isGuardrail: boolean) {
      const metric = getExperimentMetricById(metricId);

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
      setAdjustedCIs([results], pValueThreshold);
    }

    const metricDefs = metrics
      .map((metricId) => getExperimentMetricById(metricId))
      .filter(Boolean) as ExperimentMetricInterface[];
    const sortedFilteredMetrics = sortAndFilterMetricsByTags(
      metricDefs,
      metricFilter
    );

    const guardrailDefs = guardrails
      .map((metricId) => getExperimentMetricById(metricId))
      .filter(Boolean) as ExperimentMetricInterface[];
    const sortedFilteredGuardrails = sortAndFilterMetricsByTags(
      guardrailDefs,
      metricFilter
    );

    const retMetrics = sortedFilteredMetrics
      .map((metricId) => getRow(metricId, false))
      .filter((row) => row?.metric) as ExperimentTableRow[];
    const retGuardrails = sortedFilteredGuardrails
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
    pValueThreshold,
    statsEngine,
    ready,
    getExperimentMetricById,
    metricFilter,
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
                {numberFormatter.format(totalUsers)} total users
                <FaAngleRight className="chevron ml-1" />
              </div>
            }
            transitionTime={100}
          >
            <div style={{ maxWidth: "800px" }}>
              <VariationUsersTable
                variations={variations}
                users={variationUsers}
                srm={results.srm}
              />
            </div>
          </Collapsible>
        </div>
      )}

      <div className="mx-3">
        <DataQualityWarning
          results={results}
          variations={variations}
          linkToHealthTab
          setTab={setTab}
        />
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
        differenceType={differenceType}
        renderLabelColumn={getRenderLabelColumn(regressionAdjustmentEnabled)}
        metricFilter={metricFilter}
        setMetricFilter={setMetricFilter}
        metricTags={allMetricTags}
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
            differenceType={differenceType}
            renderLabelColumn={getRenderLabelColumn(
              regressionAdjustmentEnabled
            )}
            metricFilter={metricFilter}
            setMetricFilter={setMetricFilter}
            metricTags={allMetricTags}
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
    metric: ExperimentMetricInterface,
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
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                }
              : {
                  lineHeight: "1.2em",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                }
          }
        >
          <Link href={getMetricLink(metric.id)}>
            <a className="metriclabel text-dark">
              {label}
              <FactBadge metricId={metric.id} />
              {metric.official ? <OfficialBadge type="Metric" /> : null}
            </a>
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
