import React, { FC, useEffect, useState } from "react";
import { FaShippingFast } from "react-icons/fa";
import clsx from "clsx";
import Link from "next/link";
import { Flex } from "@radix-ui/themes";
import { date, datetime } from "shared/dates";
import {
  ExperimentMetricInterface,
  getMetricResultStatus,
  getLatestPhaseVariations,
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
import useApi from "@/hooks/useApi";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import ChangeColumn from "@/components/Experiment/ChangeColumn";
import Tooltip from "@/components/Tooltip/Tooltip";
import Pagination from "@/components/Pagination";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { experimentDate, RowResults } from "@/services/experiments";
import { useSearch } from "@/services/search";
import { formatNumber } from "@/services/metrics";
import track from "@/services/track";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";

interface MetricAnalysisProps {
  metric: ExperimentMetricInterface;
  outerClassName?: string;
  bandits?: boolean;
  includeOnlyResults?: boolean;
  dataWithSnapshot?: ExperimentWithSnapshot[];
  numPerPage?: number;
  differenceType?: DifferenceType;
}

interface Props {
  experimentsWithSnapshot: ExperimentWithSnapshot[];
  metric: ExperimentMetricInterface;
  bandits?: boolean;
  numPerPage?: number;
  differenceType?: DifferenceType;
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
}

const NUM_PER_PAGE = 50;

function MetricExperimentResultTab({
  experimentsWithSnapshot,
  metric,
  bandits,
  numPerPage = NUM_PER_PAGE,
  differenceType = "relative",
}: Props) {
  const [currentPage, setCurrentPage] = useState(1);
  const start = (currentPage - 1) * numPerPage;
  const end = start + numPerPage;

  const { metricDefaults } = useOrganizationMetricDefaults();
  const { ciUpper, ciLower } = useConfidenceLevels();
  const pValueThreshold = usePValueThreshold();

  const expData: MetricExperimentData[] = [];
  experimentsWithSnapshot.forEach((e) => {
    let variationResults: SnapshotMetric[] = [];
    let statsEngine: StatsEngine = "bayesian";
    let differenceType: DifferenceType = "relative";
    if (e.snapshot) {
      const snapshot = e.snapshot.analyses?.[0];
      if (snapshot) {
        statsEngine = snapshot.settings.statsEngine;
        differenceType = snapshot.settings.differenceType;
        variationResults = snapshot.results?.[0]?.variations.map((v) => {
          return v.metrics?.[metric.id];
        });
      }
    }
    const baseline = variationResults?.[0];
    const expVariations = getLatestPhaseVariations(e);
    expVariations.forEach((v, i) => {
      if (i === 0) return;
      let expVariationData: MetricExperimentData = {
        id: e.id,
        date: experimentDate(e),
        name: e.name,
        status: e.status,
        results: e.results,
        archived: e.archived,
        variations: expVariations,
        statsEngine: statsEngine,
        variationId: i,
        variationName: v.name,
        phases: e.phases,
        goalMetrics: e.goalMetrics,
        guardrailMetrics: e.guardrailMetrics,
        secondaryMetrics: e.secondaryMetrics,
        datasource: e.datasource,
        decisionFrameworkSettings: e.decisionFrameworkSettings,
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
            differenceType,
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
      expData.push(expVariationData);
    });
  });

  const { items, SortableTH } = useSearch({
    items: expData,
    localStorageKey: "metricExperiments",
    defaultSortField: "date",
    defaultSortDir: -1,
    undefinedLast: true,
    searchFields: [],
  });

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

        <td>
          <div
            key={`var-experiment${e.id}-variation${e.variationId}`}
            className={`variation variation${e.variationId} with-variation-label d-flex my-1`}
          >
            <span className="label" style={{ width: 20, height: 20 }}>
              {e.variationId}
            </span>
            <span
              className="d-inline-block text-ellipsis hover"
              style={{
                maxWidth: 200,
              }}
            >
              {e.variationName}
              {e.shipped ? (
                <Tooltip body={"Variation marked as the winner"}>
                  <FaShippingFast className="ml-1" />{" "}
                </Tooltip>
              ) : null}
            </span>
          </div>
        </td>
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
        <td>
          <div className="my-1">
            <ExperimentStatusIndicator experimentData={e} />
          </div>
        </td>
        <td>{e.users ? formatNumber(e.users) : ""}</td>
        {!bandits ? (
          e.variationResults ? (
            <ChangeColumn
              metric={metric}
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
              differenceType={differenceType}
              showCI={true}
              className={resultsHighlightClassname}
            />
          ) : (
            <td>No results available</td>
          )
        ) : null}
      </tr>
    );
  });

  return (
    <div>
      <table className="table appbox">
        <thead className="bg-light">
          <tr>
            <SortableTH field="name">Experiment</SortableTH>
            <SortableTH field="variationId">Variation</SortableTH>
            <SortableTH field="date">Date</SortableTH>
            <SortableTH field="status">Status</SortableTH>
            <SortableTH field="users">Variation Users</SortableTH>
            {/* <th>Won/lost</th> */}
            {!bandits && <SortableTH field="lift">Lift</SortableTH>}
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
}) => {
  const { data } = useApi<{
    data: ExperimentWithSnapshot[];
  }>(`/metrics/${metric.id}/experiments`, {
    shouldRun: dataWithSnapshot ? () => false : undefined,
  });
  const loading = !data;

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
