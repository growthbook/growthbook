import { FC, useMemo, useState } from "react";
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
import { FaAngleRight, FaTimes, FaUsers, FaLayerGroup } from "react-icons/fa";
import Collapsible from "react-collapsible";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  getMetricLink,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
} from "shared/experiments";
import { isDefined } from "shared/util";
import { PiWarningFill } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  ExperimentTableRow,
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
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import ConditionalWrapper from "@/components/ConditionalWrapper";
import HelperText from "@/ui/HelperText";
import Button from "@/ui/Button";
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
  endDate: string;
  isLatestPhase: boolean;
  phase: number;
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
  ssrPolyfills?: SSRPolyfills;
  hideDetails?: boolean;
  disableTimeSeriesButton?: boolean;
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
  endDate,
  isLatestPhase,
  phase,
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
  ssrPolyfills,
  hideDetails,
  disableTimeSeriesButton,
}) => {
  const {
    getExperimentMetricById,
    getFactMetricDimensions,
    metricGroups,
    ready,
  } = useDefinitions();

  const _pValueThreshold = usePValueThreshold();
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold() || _pValueThreshold;

  const [visibleDimensionMetricIds, setVisibleDimensionMetricIds] = useState<
    string[]
  >([]);
  const toggleVisibleDimensionMetricId = (metricId: string) => {
    setVisibleDimensionMetricIds((prev) =>
      prev.includes(metricId)
        ? prev.filter((id) => id !== metricId)
        : [...prev, metricId],
    );
  };

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

  const { expandedGoals, expandedSecondaries, expandedGuardrails } =
    useMemo(() => {
      const expandedGoals = expandMetricGroups(
        goalMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );
      const expandedSecondaries = expandMetricGroups(
        secondaryMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );
      const expandedGuardrails = expandMetricGroups(
        guardrailMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );

      return { expandedGoals, expandedSecondaries, expandedGuardrails };
    }, [
      goalMetrics,
      metricGroups,
      ssrPolyfills?.metricGroups,
      secondaryMetrics,
      guardrailMetrics,
    ]);

  const allMetricTags = useMemo(() => {
    const allMetricTagsSet: Set<string> = new Set();
    [...expandedGoals, ...expandedSecondaries, ...expandedGuardrails].forEach(
      (metricId) => {
        const metric =
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId);
        metric?.tags?.forEach((tag) => {
          allMetricTagsSet.add(tag);
        });
      },
    );
    return [...allMetricTagsSet];
  }, [
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
    ssrPolyfills,
    getExperimentMetricById,
  ]);

  const rows = useMemo<ExperimentTableRow[]>(() => {
    function getRow(
      metricId: string,
      resultGroup: "goal" | "secondary" | "guardrail",
    ): ExperimentTableRow[] {
      const metric =
        ssrPolyfills?.getExperimentMetricById?.(metricId) ||
        getExperimentMetricById(metricId);
      if (!metric) return [];
      const { newMetric, overrideFields } = applyMetricOverrides(
        metric,
        metricOverrides,
      );
      let metricSnapshotSettings: MetricSnapshotSettings | undefined;
      if (settingsForSnapshotMetrics) {
        metricSnapshotSettings = settingsForSnapshotMetrics.find(
          (s) => s.metric === metricId,
        );
      }
      // Get dimension count for this metric
      const numDimensions =
        ssrPolyfills?.getFactMetricDimensions?.(metricId)?.length ||
        getFactMetricDimensions?.(metricId)?.length ||
        0;

      const parentRow: ExperimentTableRow = {
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
        numDimensions,
      };

      const rows: ExperimentTableRow[] = [parentRow];

      // Add dimension rows if this metric has dimensions and is visible
      if (numDimensions > 0 && visibleDimensionMetricIds.includes(metricId)) {
        const dimensionData =
          ssrPolyfills?.getFactMetricDimensions?.(metricId) ||
          getFactMetricDimensions?.(metricId) ||
          [];

        dimensionData.forEach((dimension) => {
          const dimensionRow: ExperimentTableRow = {
            label: `  ${dimension.dimensionColumnName}`,
            metric: {
              ...newMetric,
              name: dimension.dimensionColumnName, // Use dimension name instead of parent metric name
            },
            metricOverrideFields: overrideFields,
            rowClass: `${newMetric?.inverse ? "inverse" : ""} dimension-row`,
            variations: results.variations.map((v) => {
              // For now, use the same data as parent - this will be updated later with actual dimension data
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
            numDimensions: 0, // Dimension rows don't have their own dimensions
            isDimensionRow: true,
            parentRowId: metricId,
            dimensionColumn: dimension.dimensionColumn,
            dimensionColumnName: dimension.dimensionColumnName,
            dimensionValues: dimension.dimensionValues,
            stableDimensionValues: dimension.stableDimensionValues,
            maxDimensionValues: dimension.maxDimensionValues,
          };
          rows.push(dimensionRow);
        });
      }

      return rows;
    }

    if (!results || !results.variations || (!ready && !ssrPolyfills)) return [];
    if (pValueCorrection && statsEngine === "frequentist") {
      // Only include goals in calculation, not secondary or guardrails
      setAdjustedPValuesOnResults([results], expandedGoals, pValueCorrection);
      setAdjustedCIs([results], pValueThreshold);
    }

    const metricDefs = expandedGoals
      .map(
        (metricId) =>
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId),
      )
      .filter(isDefined);
    const sortedFilteredMetrics = sortAndFilterMetricsByTags(
      metricDefs,
      metricFilter,
    );

    const secondaryDefs = expandedSecondaries
      .map(
        (metricId) =>
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId),
      )
      .filter(isDefined);
    const sortedFilteredSecondary = sortAndFilterMetricsByTags(
      secondaryDefs,
      metricFilter,
    );

    const guardrailDefs = expandedGuardrails
      .map(
        (metricId) =>
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId),
      )
      .filter(isDefined);
    const sortedFilteredGuardrails = sortAndFilterMetricsByTags(
      guardrailDefs,
      metricFilter,
    );

    const retMetrics = sortedFilteredMetrics.flatMap((metricId) =>
      getRow(metricId, "goal"),
    );
    const retSecondary = sortedFilteredSecondary.flatMap((metricId) =>
      getRow(metricId, "secondary"),
    );
    const retGuardrails = sortedFilteredGuardrails.flatMap((metricId) =>
      getRow(metricId, "guardrail"),
    );
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
    ssrPolyfills,
    getExperimentMetricById,
    metricFilter,
    visibleDimensionMetricIds,
    getFactMetricDimensions,
  ]);

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
                    {numberFormatter.format(totalUsers)} total units
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
              totalUsers={totalUsers}
              multipleExposures={multipleExposures}
            />
          </div>
        </>
      )}

      {expandedGoals.length ? (
        <ResultsTable
          dateCreated={reportDate}
          isLatestPhase={isLatestPhase}
          phase={phase}
          startDate={startDate}
          endDate={endDate}
          status={status}
          queryStatusData={queryStatusData}
          variations={variations}
          variationFilter={variationFilter}
          baselineRow={baselineRow}
          rows={rows.filter((r) => r.resultGroup === "goal")}
          id={id}
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
            statsEngine,
            hideDetails,
            experimentType,
            visibleDimensionMetricIds,
            toggleVisibleDimensionMetricId,
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
          ssrPolyfills={ssrPolyfills}
          disableTimeSeriesButton={disableTimeSeriesButton}
          isHoldout={experimentType === "holdout"}
        />
      ) : null}

      {!mainTableOnly && expandedSecondaries.length ? (
        <div className="mt-4">
          <ResultsTable
            dateCreated={reportDate}
            isLatestPhase={isLatestPhase}
            phase={phase}
            startDate={startDate}
            endDate={endDate}
            status={status}
            queryStatusData={queryStatusData}
            variations={variations}
            variationFilter={variationFilter}
            baselineRow={baselineRow}
            rows={rows.filter((r) => r.resultGroup === "secondary")}
            id={id}
            tableRowAxis="metric"
            labelHeader="Secondary Metrics"
            editMetrics={editMetrics}
            statsEngine={statsEngine}
            sequentialTestingEnabled={sequentialTestingEnabled}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            renderLabelColumn={getRenderLabelColumn(
              regressionAdjustmentEnabled,
              statsEngine,
              hideDetails,
              undefined,
              visibleDimensionMetricIds,
              toggleVisibleDimensionMetricId,
            )}
            metricFilter={metricFilter}
            setMetricFilter={setMetricFilter}
            metricTags={allMetricTags}
            isTabActive={isTabActive}
            noStickyHeader={noStickyHeader}
            noTooltip={noTooltip}
            isBandit={isBandit}
            ssrPolyfills={ssrPolyfills}
            disableTimeSeriesButton={disableTimeSeriesButton}
            isHoldout={experimentType === "holdout"}
          />
        </div>
      ) : null}

      {!mainTableOnly && expandedGuardrails.length ? (
        <div className="mt-4">
          <ResultsTable
            dateCreated={reportDate}
            isLatestPhase={isLatestPhase}
            phase={phase}
            startDate={startDate}
            endDate={endDate}
            status={status}
            queryStatusData={queryStatusData}
            variations={variations}
            variationFilter={variationFilter}
            baselineRow={baselineRow}
            rows={rows.filter((r) => r.resultGroup === "guardrail")}
            id={id}
            tableRowAxis="metric"
            labelHeader="Guardrail Metrics"
            editMetrics={editMetrics}
            statsEngine={statsEngine}
            sequentialTestingEnabled={sequentialTestingEnabled}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            renderLabelColumn={getRenderLabelColumn(
              regressionAdjustmentEnabled,
              statsEngine,
              hideDetails,
              undefined,
              visibleDimensionMetricIds,
              toggleVisibleDimensionMetricId,
            )}
            metricFilter={metricFilter}
            setMetricFilter={setMetricFilter}
            metricTags={allMetricTags}
            isTabActive={isTabActive}
            noStickyHeader={noStickyHeader}
            noTooltip={noTooltip}
            isBandit={isBandit}
            ssrPolyfills={ssrPolyfills}
            disableTimeSeriesButton={disableTimeSeriesButton}
            isHoldout={experimentType === "holdout"}
          />
        </div>
      ) : (
        <></>
      )}
    </>
  );
};
export default CompactResults;

export function getRenderLabelColumn(
  regressionAdjustmentEnabled?: boolean,
  statsEngine?: StatsEngine,
  hideDetails?: boolean,
  experimentType?: ExperimentType,
  visibleDimensionMetricIds?: string[],
  toggleVisibleDimensionMetricId?: (metricId: string) => void,
) {
  return function renderLabelColumn(
    label: string,
    metric: ExperimentMetricInterface,
    row?: ExperimentTableRow,
    maxRows?: number,
    numDimensions?: number,
  ) {
    // Check if this is a dimension row
    const isDimensionRow = row?.isDimensionRow || false;

    const invalidHoldoutMetric =
      experimentType === "holdout" &&
      metric?.windowSettings?.type === "conversion";
    const metricLink = (
      <Tooltip
        body={
          <MetricTooltipBody
            metric={metric}
            row={row}
            statsEngine={statsEngine}
            reportRegressionAdjustmentEnabled={regressionAdjustmentEnabled}
            hideDetails={hideDetails}
            extraInfo={
              invalidHoldoutMetric ? (
                <div className="mb-2">
                  <HelperText status="warning">
                    Metrics with conversion windows are not supported in
                    holdouts
                  </HelperText>
                </div>
              ) : undefined
            }
          />
        }
        tipPosition="right"
        className={`d-inline-block font-weight-bold metric-label ${isDimensionRow ? "dimension-row-label" : ""}`}
        flipTheme={false}
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
                  color: isDimensionRow ? "var(--gray-11)" : undefined,
                  fontStyle: isDimensionRow ? "italic" : undefined,
                }
              : {
                  lineHeight: "1.2em",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                  color: isDimensionRow ? "var(--gray-11)" : undefined,
                  fontStyle: isDimensionRow ? "italic" : undefined,
                }
          }
        >
          <ConditionalWrapper
            condition={!hideDetails && !isDimensionRow}
            wrapper={
              <Link
                href={getMetricLink(metric.id)}
                className="metriclabel text-dark"
              />
            }
          >
            {invalidHoldoutMetric ? (
              <PiWarningFill
                style={{ color: "var(--amber-11)" }}
                className="mr-1"
              />
            ) : null}
            <MetricName metric={metric} disableTooltip />
            <PercentileLabel metric={metric} />
          </ConditionalWrapper>
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

    // Check if metric has dimensions available (only for parent rows)
    const hasDimensions = !isDimensionRow && (numDimensions || 0) > 0;
    const isDimensionVisible =
      visibleDimensionMetricIds?.includes(metric.id) || false;

    const dimensionToggleButton = hasDimensions ? (
      <Tooltip
        body={
          isDimensionVisible
            ? "Hide dimension analysis"
            : "Show dimension analysis"
        }
        className="mr-1"
      >
        <Button
          size="xs"
          variant="ghost"
          color="gray"
          onClick={() => {
            toggleVisibleDimensionMetricId?.(metric.id);
          }}
          style={{
            padding: "2px 4px",
            minWidth: "auto",
            height: "auto",
          }}
        >
          <FaLayerGroup
            size={12}
            style={{
              color: isDimensionVisible ? "var(--purple-11)" : "var(--gray-11)",
            }}
          />
        </Button>
      </Tooltip>
    ) : null;

    return (
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        {dimensionToggleButton}
        {metricLink}
        {metricInverseIconDisplay}
        {cupedIconDisplay}
      </span>
    );
  };
}
