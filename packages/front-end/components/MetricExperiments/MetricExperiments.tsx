import React, { FC, useEffect, useMemo, useState } from "react";
import { PiTrophyDuotone } from "react-icons/pi";
import clsx from "clsx";
import { Flex } from "@radix-ui/themes";
import { date, datetime } from "shared/dates";
import {
  ExperimentMetricDefinition,
  getLatestPhaseVariations,
  getMetricResultStatus,
  isFactMetric,
} from "shared/experiments";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import {
  ExperimentWithSnapshot,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import {
  ExperimentDecisionFrameworkSettings,
  ExperimentPhaseStringDates,
  ExperimentResultsType,
  ExperimentStatus,
  Variation,
} from "shared/types/experiment";
import Link from "@/ui/Link";
import VariationLabel from "@/ui/VariationLabel";
import useApi from "@/hooks/useApi";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import ChangeColumn from "@/components/Experiment/ChangeColumn";
import Tooltip from "@/components/Tooltip/Tooltip";
import Pagination from "@/components/Pagination";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import useSignificanceThresholdsByProject from "@/hooks/useSignificanceThresholdsByProject";
import { experimentDate, RowResults } from "@/services/experiments";
import { useSearch } from "@/services/search";
import { formatNumber } from "@/services/metrics";
import track from "@/services/track";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";

// Stored per-block column config (order + visibility). The "Experiment" column
// is always shown first and is intentionally NOT managed here.
export interface MetricExperimentColumnConfig {
  id: string;
  visible: boolean;
}

interface ManagedColumnDef {
  // Doubles as the sort field, so it must be a key of MetricExperimentData.
  id: keyof MetricExperimentData;
  label: string;
  // Not applicable to bandit tables (no lift shown for bandits).
  hideForBandits?: boolean;
}

// The reorderable / hideable columns, in their default order. "Experiment" is
// pinned separately and excluded from this list.
export const METRIC_EXPERIMENT_MANAGED_COLUMNS: ManagedColumnDef[] = [
  { id: "variationId", label: "Variation" },
  { id: "date", label: "Date" },
  { id: "status", label: "Status" },
  { id: "users", label: "Variation Units" },
  { id: "lift", label: "Lift", hideForBandits: true },
];

/**
 * Resolve the effective ordered column list from a stored config. Missing
 * config = default order, all visible. Stored ids are applied in their saved
 * order; any known columns not present in the config are appended (visible) so
 * nothing silently disappears. Lift is dropped entirely for bandit tables.
 */
export function resolveMetricExperimentColumns(
  stored: MetricExperimentColumnConfig[] | undefined,
  bandits: boolean,
): Array<ManagedColumnDef & { visible: boolean }> {
  const base = METRIC_EXPERIMENT_MANAGED_COLUMNS.filter(
    (c) => !(bandits && c.hideForBandits),
  );
  if (!stored || stored.length === 0) {
    return base.map((c) => ({ ...c, visible: true }));
  }
  const byId = new Map(base.map((c) => [c.id as string, c]));
  const ordered: Array<ManagedColumnDef & { visible: boolean }> = [];
  const seen = new Set<string>();
  stored.forEach((s) => {
    const col = byId.get(s.id);
    if (!col) return;
    ordered.push({ ...col, visible: s.visible });
    seen.add(s.id);
  });
  base.forEach((c) => {
    if (!seen.has(c.id)) ordered.push({ ...c, visible: true });
  });
  return ordered;
}

interface MetricAnalysisProps {
  metric: ExperimentMetricDefinition;
  outerClassName?: string;
  bandits?: boolean;
  includeOnlyResults?: boolean;
  dataWithSnapshot?: ExperimentWithSnapshot[];
  numPerPage?: number;
  differenceType?: DifferenceType;
  columns?: MetricExperimentColumnConfig[];
}

interface Props {
  experimentsWithSnapshot: ExperimentWithSnapshot[];
  metric: ExperimentMetricDefinition;
  bandits?: boolean;
  numPerPage?: number;
  differenceType?: DifferenceType;
  columns?: MetricExperimentColumnConfig[];
}

export interface MetricExperimentData {
  id: string;
  date: string;
  name: string;
  status: ExperimentStatus;
  results?: ExperimentResultsType;
  archived: boolean;
  variations: Variation[];
  statsEngine: StatsEngine;
  variationId: number;
  variationName: string;
  variationResults?: SnapshotMetric;
  // The difference type of the analysis these results were computed under.
  // May differ from the requested difference type when the snapshot has no
  // matching analysis — formatting must always use this value so the numbers
  // are never rendered as a type they weren't computed as.
  differenceType: DifferenceType;
  significant?: boolean;
  lift?: number | undefined;
  users?: number;
  shipped?: boolean;
  resultsStatus?: string;
  directionalStatus?: "winning" | "losing";
  phases: ExperimentPhaseStringDates[];
  guardrailMetrics: string[];
  goalMetrics: string[];
  secondaryMetrics: string[];
  datasource: string;
  decisionFrameworkSettings: ExperimentDecisionFrameworkSettings;
  project?: string;
}

const NUM_PER_PAGE = 50;

function MetricExperimentResultTab({
  experimentsWithSnapshot,
  metric,
  bandits,
  numPerPage = NUM_PER_PAGE,
  differenceType = "relative",
  columns,
}: Props) {
  const [currentPage, setCurrentPage] = useState(1);
  const start = (currentPage - 1) * numPerPage;
  const end = start + numPerPage;

  const { metricDefaults } = useOrganizationMetricDefaults();
  const bayesianConfidenceLevels = useConfidenceLevels(undefined);
  const pValueThreshold = usePValueThreshold(undefined);
  const defaultSignificanceThresholds = {
    bayesianConfidenceLevels,
    pValueThreshold,
  };
  // Experiments in this table can span projects. Resolve project-scoped
  // significance thresholds up front for every project in the org so we can
  // look them up per-experiment without calling hooks in a loop.
  const significanceThresholdsByProject = useSignificanceThresholdsByProject();

  const expData: MetricExperimentData[] = useMemo(() => {
    const rows: MetricExperimentData[] = [];
    experimentsWithSnapshot.forEach((e) => {
      const {
        bayesianConfidenceLevels: { ciUpper, ciLower },
        pValueThreshold,
      } =
        significanceThresholdsByProject.get(e.project || "") ??
        defaultSignificanceThresholds;
      let variationResults: SnapshotMetric[] = [];
      let statsEngine: StatsEngine = "bayesian";
      // The difference type actually used for this experiment's numbers. A
      // snapshot can contain multiple analyses that differ by difference
      // type; prefer the one matching the requested type, otherwise fall
      // back to the default analysis and surface its real difference type so
      // significance and formatting stay consistent with the data.
      let effectiveDifferenceType: DifferenceType = "relative";
      if (e.snapshot) {
        const analysis =
          e.snapshot.analyses?.find(
            (a) => a.settings.differenceType === differenceType,
          ) ?? e.snapshot.analyses?.[0];
        if (analysis) {
          statsEngine = analysis.settings.statsEngine;
          effectiveDifferenceType = analysis.settings.differenceType;
          variationResults = analysis.results?.[0]?.variations.map((v) => {
            return v.metrics?.[metric.id];
          });
        }
      }
      const baseline = variationResults?.[0];
      getLatestPhaseVariations(e).forEach((v, i) => {
        if (i === 0) return;
        let expVariationData: MetricExperimentData = {
          id: e.id,
          date: experimentDate(e),
          name: e.name,
          status: e.status,
          results: e.results,
          archived: e.archived,
          variations: getLatestPhaseVariations(e),
          statsEngine: statsEngine,
          variationId: i,
          variationName: v.name,
          differenceType: effectiveDifferenceType,
          phases: e.phases,
          goalMetrics: e.goalMetrics,
          guardrailMetrics: e.guardrailMetrics,
          secondaryMetrics: e.secondaryMetrics,
          datasource: e.datasource,
          decisionFrameworkSettings: e.decisionFrameworkSettings,
          project: e.project,
        };
        if (!bandits && baseline && variationResults[i]) {
          const { significant, resultsStatus, directionalStatus } =
            getMetricResultStatus({
              metric: metric,
              metricDefaults,
              baseline: baseline,
              stats: variationResults[i],
              ciLower,
              ciUpper,
              pValueThreshold,
              statsEngine,
              differenceType: effectiveDifferenceType,
            });
          expVariationData = {
            ...expVariationData,
            variationResults: variationResults[i],
            lift: variationResults[i].uplift?.mean ?? undefined,
            users: variationResults[i].users,
            shipped: e.results === "won" && e.winner == i,
            significant: significant,
            resultsStatus: resultsStatus,
            directionalStatus: directionalStatus,
          };
        }
        rows.push(expVariationData);
      });
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    experimentsWithSnapshot,
    metric,
    bandits,
    differenceType,
    metricDefaults,
    significanceThresholdsByProject,
    bayesianConfidenceLevels,
    pValueThreshold,
  ]);

  const { items, SortableTH } = useSearch({
    items: expData,
    localStorageKey: "metricExperiments",
    defaultSortField: "date",
    defaultSortDir: -1,
    undefinedLast: true,
    searchFields: [],
    // This is a sort-only table embedded inside pages that own the URL `q`
    // param (e.g. MetricEffects). Without this, the hook would latch onto
    // the page's filter string at mount, which combined with an empty
    // searchFields collapses the table to zero rows.
    disableUrlSearchTerm: true,
  });

  // Keep the current page valid when inputs change: reset on metric switch,
  // clamp when a filter/sort shrinks the result set.
  const totalPages = Math.max(1, Math.ceil(items.length / numPerPage));
  useEffect(() => {
    setCurrentPage(1);
  }, [metric.id]);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  // Effective visible columns (order + visibility) after applying the stored
  // config. "Experiment" is always rendered first, outside this list.
  const visibleColumns = resolveMetricExperimentColumns(
    columns,
    !!bandits,
  ).filter((c) => c.visible);

  const renderCell = (
    colId: string,
    e: MetricExperimentData,
    resultsHighlightClassname: string,
  ) => {
    switch (colId) {
      case "variationId":
        return (
          <td>
            <Flex
              align="center"
              gap="1"
              className="my-1"
              style={{ maxWidth: 220 }}
            >
              <VariationLabel number={e.variationId} name={e.variationName} />
              {e.shipped ? (
                <Tooltip body={"Variation marked as the winner"}>
                  <PiTrophyDuotone />
                </Tooltip>
              ) : null}
            </Flex>
          </td>
        );
      case "date":
        return (
          <td className="nowrap" title={datetime(e.date)}>
            {e.status === "running"
              ? "started"
              : e.status === "draft"
                ? "created"
                : e.status === "stopped"
                  ? "ended"
                  : ""}{" "}
            {date(e.date)}
          </td>
        );
      case "status":
        return (
          <td>
            <div className="my-1">
              <ExperimentStatusIndicator experimentData={e} />
            </div>
          </td>
        );
      case "users":
        return <td>{e.users ? formatNumber(e.users) : ""}</td>;
      case "lift":
        return e.variationResults ? (
          <ChangeColumn
            metric={metric}
            pValueThreshold={
              (
                significanceThresholdsByProject.get(e.project || "") ??
                defaultSignificanceThresholds
              ).pValueThreshold
            }
            stats={e.variationResults}
            rowResults={{
              enoughData: true,
              directionalStatus: e.directionalStatus ?? "losing",
              hasScaledImpact: true,
              significant: e.significant ?? false,
              resultsStatus:
                (e.resultsStatus as RowResults["resultsStatus"]) ?? "",
              suspiciousChange: false,
              suspiciousThreshold: 0,
              minPercentChange: 0,
              currentMetricTotal: e.variationResults?.value ?? 0,
            }}
            showPlusMinus={false}
            statsEngine={e.statsEngine}
            differenceType={e.differenceType}
            showCI={true}
            className={resultsHighlightClassname}
          />
        ) : (
          <td>No results available</td>
        );
      default:
        return null;
    }
  };

  const expRows = items.slice(start, end).map((e) => {
    const resultsHighlightClassname = clsx(e.resultsStatus, {
      "non-significant": !e.significant,
      hover: false,
    });
    return (
      <tr
        key={`${e.id}-${e.variationId}`}
        className="hover-highlight impact-results"
      >
        <td>
          <div className="my-1">
            <Link className="font-weight-bold" href={`/experiment/${e.id}`}>
              {e.name}
            </Link>
          </div>
        </td>
        {visibleColumns.map((c) => (
          <React.Fragment key={`${e.id}-${e.variationId}-${c.id}`}>
            {renderCell(c.id, e, resultsHighlightClassname)}
          </React.Fragment>
        ))}
      </tr>
    );
  });

  return (
    <div>
      <table className="table appbox">
        <thead className="bg-light">
          <tr>
            <SortableTH field="name" className="nowrap">
              Experiment
            </SortableTH>
            {visibleColumns.map((c) => (
              <SortableTH key={c.id} field={c.id} className="nowrap">
                {c.label}
              </SortableTH>
            ))}
          </tr>
        </thead>
        <tbody>{expRows}</tbody>
      </table>
      {items.length > numPerPage && (
        <Pagination
          numItemsTotal={items.length}
          currentPage={currentPage}
          perPage={numPerPage}
          onPageChange={setCurrentPage}
        />
      )}
    </div>
  );
}

const MetricExperiments: FC<MetricAnalysisProps> = ({
  metric,
  outerClassName,
  bandits = false,
  includeOnlyResults = false,
  dataWithSnapshot,
  numPerPage = NUM_PER_PAGE,
  differenceType = "relative",
  columns,
}) => {
  const { data } = useApi<{
    data: ExperimentWithSnapshot[];
  }>(`/metrics/${metric.id}/experiments`, {
    shouldRun: dataWithSnapshot ? () => false : undefined,
  });
  // When the parent passes in `dataWithSnapshot`, it owns the loading state
  // and we should never block on the (disabled) SWR fetch.
  const loading = dataWithSnapshot === undefined && !data;

  const metricExperiments = (dataWithSnapshot ?? data?.data ?? []).filter(
    (e) =>
      (bandits
        ? e.type === "multi-armed-bandit"
        : e.type !== "multi-armed-bandit") &&
      (includeOnlyResults
        ? e.status !== "draft" && e.snapshot?.status === "success"
        : true),
  );

  const body = loading ? (
    <Flex mt="1" mb="2">
      <LoadingSpinner />
    </Flex>
  ) : !metricExperiments?.length ? (
    <Callout status="info" mt="1" mb="2">
      0 {bandits ? "bandits" : "experiments"} with this metric found.
    </Callout>
  ) : (
    <MetricExperimentResultTab
      experimentsWithSnapshot={metricExperiments}
      metric={metric}
      bandits={bandits}
      numPerPage={numPerPage}
      differenceType={differenceType}
      columns={columns}
    />
  );

  useEffect(() => {
    track(`Load Metric ${bandits ? "Bandits" : "Experiments"}`, {
      type: isFactMetric(metric) ? "fact" : "classic",
    });
  }, [metric, bandits]);

  return (
    <div
      className={
        outerClassName !== undefined ? outerClassName : "appbox p-3 mb-3"
      }
    >
      <div className="mt-1" style={{ maxHeight: 800, overflowY: "auto" }}>
        {body}
      </div>
    </div>
  );
};

export default MetricExperiments;
