import React, { FC, useMemo } from "react";
import { MdSwapCalls } from "react-icons/md";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricSnapshotSettings,
} from "back-end/types/report";
import {
  ExperimentStatus,
  ExperimentType,
  MetricOverride,
} from "back-end/types/experiment";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "back-end/types/stats";
import Link from "next/link";
import { FaAngleRight, FaTimes, FaUsers } from "react-icons/fa";
import Collapsible from "react-collapsible";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  getMetricLink,
} from "shared/experiments";
import { isDefined } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  setAdjustedPValuesOnResults,
  ExperimentTableRow,
  setAdjustedCIs,
  hasRisk,
} from "@/services/experiments";
import { GBCuped } from "@/components/Icons";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import {
  ResultsMetricFilters,
  sortAndFilterMetricsByTags,
} from "@/components/Experiment/Results";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricTooltipBody from "@/components/Metrics/MetricTooltipBody";
import MetricName, { PercentileLabel } from "@/components/Metrics/MetricName";
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
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];
  id: string;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  regressionAdjustmentEnabled?: boolean;
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  sequentialTestingEnabled?: boolean;
  differenceType: DifferenceType;
  metricFilter?: ResultsMetricFilters;
  setMetricFilter?: (filter: ResultsMetricFilters) => void;
  isTabActive: boolean;
  setTab?: (tab: ExperimentTab) => void;
  mainTableOnly?: boolean;
  noStickyHeader?: boolean;
  noTooltip?: boolean;
  experimentType?: ExperimentType;
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
  goalMetrics,
  guardrailMetrics,
  secondaryMetrics,
  metricOverrides,
  id,
  statsEngine,
  pValueCorrection,
  regressionAdjustmentEnabled,
  settingsForSnapshotMetrics,
  sequentialTestingEnabled,
  differenceType,
  metricFilter,
  setMetricFilter,
  isTabActive,
  setTab,
  mainTableOnly,
  noStickyHeader,
  noTooltip,
  experimentType,
}) => {
  const { getExperimentMetricById, metricGroups, ready } = useDefinitions();
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

  const {
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
  } = useMemo(() => {
    const expandedGoals = expandMetricGroups(goalMetrics, metricGroups);
    const expandedSecondaries = expandMetricGroups(
      secondaryMetrics,
      metricGroups
    );
    const expandedGuardrails = expandMetricGroups(
      guardrailMetrics,
      metricGroups
    );

    return { expandedGoals, expandedSecondaries, expandedGuardrails };
  }, [goalMetrics, metricGroups, secondaryMetrics, guardrailMetrics]);

  const allMetricTags = useMemo(() => {
    const allMetricTagsSet: Set<string> = new Set();
    [...expandedGoals, ...expandedSecondaries, ...expandedGuardrails].forEach(
      (metricId) => {
        const metric = getExperimentMetricById(metricId);
        metric?.tags?.forEach((tag) => {
          allMetricTagsSet.add(tag);
        });
      }
    );
    return [...allMetricTagsSet];
  }, [
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
    getExperimentMetricById,
  ]);

  const rows = useMemo<ExperimentTableRow[]>(() => {
    function getRow(
      metricId: string,
      resultGroup: "goal" | "secondary" | "guardrail"
    ) {
      const metric = getExperimentMetricById(metricId);

      if (!metric) {
        return null;
      }
      const { newMetric, overrideFields } = applyMetricOverrides(
        metric,
        metricOverrides
      );
      let metricSnapshotSettings: MetricSnapshotSettings | undefined;
      if (settingsForSnapshotMetrics) {
        metricSnapshotSettings = settingsForSnapshotMetrics.find(
          (s) => s.metric === metricId
        );
      }
      return {
        label: newMetric?.name,
        metric: newMetric,
        metricOverrideFields: overrideFields,
        rowClass: newMetric?.inverse ? "inverse" : "",
        variations: results.variations.map((v) => {
          return (
            v.metrics?.[metricId] || {
              users: 0,
              value: 0,
              cr: 0,
              errorMessage: "No data",
            }
          );
        }),
        metricSnapshotSettings,
        resultGroup,
      };
    }

    if (!results || !results.variations || !ready) return [];
    if (pValueCorrection && statsEngine === "frequentist") {
      // Only include goals in calculation, not secondary or guardrails
      setAdjustedPValuesOnResults([results], expandedGoals, pValueCorrection);
      setAdjustedCIs([results], pValueThreshold);
    }

    const metricDefs = expandedGoals
      .map((metricId) => getExperimentMetricById(metricId))
      .filter(isDefined);
    const sortedFilteredMetrics = sortAndFilterMetricsByTags(
      metricDefs,
      metricFilter
    );

    const secondaryDefs = expandedSecondaries
      .map((metricId) => getExperimentMetricById(metricId))
      .filter(isDefined);
    const sortedFilteredSecondary = sortAndFilterMetricsByTags(
      secondaryDefs,
      metricFilter
    );

    const guardrailDefs = expandedGuardrails
      .map((metricId) => getExperimentMetricById(metricId))
      .filter(isDefined);
    const sortedFilteredGuardrails = sortAndFilterMetricsByTags(
      guardrailDefs,
      metricFilter
    );

    const retMetrics = sortedFilteredMetrics
      .map((metricId) => getRow(metricId, "goal"))
      .filter(isDefined);
    const retSecondary = sortedFilteredSecondary
      .map((metricId) => getRow(metricId, "secondary"))
      .filter(isDefined);
    const retGuardrails = sortedFilteredGuardrails
      .map((metricId) => getRow(metricId, "guardrail"))
      .filter(isDefined);
    return [...retMetrics, ...retSecondary, ...retGuardrails];
  }, [
    results,
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
    metricOverrides,
    settingsForSnapshotMetrics,
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

  const isBandit = experimentType === "multi-armed-bandit";

  return (
    <>
      {!mainTableOnly && (
        <>
          {!isBandit && status !== "draft" && totalUsers > 0 && (
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
            {experimentType !== "multi-armed-bandit" && (
              <DataQualityWarning
                results={results}
                variations={variations}
                linkToHealthTab
                setTab={setTab}
                isBandit={isBandit}
              />
            )}
            <MultipleExposureWarning
              users={users}
              multipleExposures={multipleExposures}
            />
          </div>
        </>
      )}

      {expandedGoals.length ? (
        <ResultsTable
          dateCreated={reportDate}
          isLatestPhase={isLatestPhase}
          startDate={startDate}
          status={status}
          queryStatusData={queryStatusData}
          variations={variations}
          variationFilter={variationFilter}
          baselineRow={baselineRow}
          rows={rows.filter((r) => r.resultGroup === "goal")}
          id={id}
          hasRisk={hasRisk(rows)}
          tableRowAxis="metric"
          labelHeader={
            experimentType !== "multi-armed-bandit"
              ? "Goal Metrics"
              : "Decision Metric"
          }
          editMetrics={
            experimentType !== "multi-armed-bandit" ? editMetrics : undefined
          }
          statsEngine={statsEngine}
          sequentialTestingEnabled={sequentialTestingEnabled}
          pValueCorrection={pValueCorrection}
          differenceType={differenceType}
          renderLabelColumn={getRenderLabelColumn(
            regressionAdjustmentEnabled,
            statsEngine
          )}
          metricFilter={
            experimentType !== "multi-armed-bandit" ? metricFilter : undefined
          }
          setMetricFilter={
            experimentType !== "multi-armed-bandit"
              ? setMetricFilter
              : undefined
          }
          metricTags={allMetricTags}
          isTabActive={isTabActive}
          noStickyHeader={noStickyHeader}
          noTooltip={noTooltip}
          isBandit={isBandit}
          isGoalMetrics={true}
        />
      ) : null}

      {!mainTableOnly && expandedSecondaries.length ? (
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
            rows={rows.filter((r) => r.resultGroup === "secondary")}
            id={id}
            hasRisk={hasRisk(rows)}
            tableRowAxis="metric"
            labelHeader="Secondary Metrics"
            editMetrics={editMetrics}
            statsEngine={statsEngine}
            sequentialTestingEnabled={sequentialTestingEnabled}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            renderLabelColumn={getRenderLabelColumn(
              regressionAdjustmentEnabled,
              statsEngine
            )}
            metricFilter={metricFilter}
            setMetricFilter={setMetricFilter}
            metricTags={allMetricTags}
            isTabActive={isTabActive}
            noStickyHeader={noStickyHeader}
            noTooltip={noTooltip}
            isBandit={isBandit}
          />
        </div>
      ) : null}

      {!mainTableOnly && expandedGuardrails.length ? (
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
            rows={rows.filter((r) => r.resultGroup === "guardrail")}
            id={id}
            hasRisk={hasRisk(rows)}
            tableRowAxis="metric"
            labelHeader="Guardrail Metrics"
            editMetrics={editMetrics}
            statsEngine={statsEngine}
            sequentialTestingEnabled={sequentialTestingEnabled}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            renderLabelColumn={getRenderLabelColumn(
              regressionAdjustmentEnabled,
              statsEngine
            )}
            metricFilter={metricFilter}
            setMetricFilter={setMetricFilter}
            metricTags={allMetricTags}
            isTabActive={isTabActive}
            noStickyHeader={noStickyHeader}
            noTooltip={noTooltip}
            isBandit={isBandit}
          />
        </div>
      ) : (
        <></>
      )}
    </>
  );
};
export default CompactResults;

export function getRenderLabelColumn(regressionAdjustmentEnabled, statsEngine) {
  return function renderLabelColumn(
    label: string,
    metric: ExperimentMetricInterface,
    row?: ExperimentTableRow,
    maxRows?: number
  ) {
    const metricLink = (
      <Tooltip
        body={
          <MetricTooltipBody
            metric={metric}
            row={row}
            statsEngine={statsEngine}
            reportRegressionAdjustmentEnabled={regressionAdjustmentEnabled}
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
          <Link
            href={getMetricLink(metric.id)}
            className="metriclabel text-dark"
          >
            <MetricName id={metric.id} disableTooltip />
            <PercentileLabel metric={metric} />
          </Link>
        </span>
      </Tooltip>
    );

    const cupedIconDisplay =
      regressionAdjustmentEnabled &&
      !row?.metricSnapshotSettings?.regressionAdjustmentEnabled ? (
        <Tooltip
          className="ml-1"
          body={
            row?.metricSnapshotSettings?.regressionAdjustmentReason
              ? `CUPED disabled: ${row?.metricSnapshotSettings?.regressionAdjustmentReason}`
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
