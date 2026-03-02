import React, { FC, useState } from "react";
import { FaShippingFast } from "react-icons/fa";
import clsx from "clsx";
import Link from "next/link";
import { date, datetime } from "shared/dates";
import {
  ExperimentMetricInterface,
  getMetricResultStatus,
  getLatestPhaseVariations,
  isSuspiciousUplift,
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
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { experimentDate, RowResults } from "@/services/experiments";
import { useAddComputedFields, useSearch } from "@/services/search";
import Tooltip from "@/components/Tooltip/Tooltip";
import { formatNumber } from "@/services/metrics";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import ChangeColumn from "@/components/Experiment/ChangeColumn";
import Pagination from "@/components/Pagination";
import Checkbox from "@/ui/Checkbox";

interface Props {
  experimentsWithSnapshot: ExperimentWithSnapshot[];
  metrics: ExperimentMetricInterface[];
  bandits?: boolean;
  numPerPage?: number;
  differenceType?: DifferenceType;
  excludedExperimentVariations: {
    experimentId: string;
    variationIndex: number;
  }[];
  setExcludedExperimentVariations: (
    experimentVariations: { experimentId: string; variationIndex: number }[],
  ) => void;
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
  variationIndex: number;
  variationName: string;
  metricResults: {
    results: SnapshotMetric;
    significant: boolean;
    lift?: number;
    resultsStatus?: string;
    directionalStatus?: "winning" | "losing";
    suspiciousChange: boolean;
    suspiciousThreshold: number;
    minPercentChange: number;
  }[];
  users?: number;
  shipped?: boolean;
  phases: ExperimentPhaseStringDates[];
  guardrailMetrics: string[];
  goalMetrics: string[];
  secondaryMetrics: string[];
  datasource: string;
  decisionFrameworkSettings: ExperimentDecisionFrameworkSettings;
}

// Interface for computed data with dynamic lift fields
export interface ComputedMetricExperimentData extends MetricExperimentData {
  // only show lift for first 2 metrics
  // TODO generalize to more metrics
  lift0?: number;
  lift1?: number;
  included: boolean;
}

const NUM_PER_PAGE = 50;

const ExperimentWithMetricsTable: FC<Props> = ({
  experimentsWithSnapshot,
  metrics,
  bandits,
  numPerPage = NUM_PER_PAGE,
  differenceType = "relative",
  excludedExperimentVariations,
  setExcludedExperimentVariations,
}: Props) => {
  const [currentPage, setCurrentPage] = useState(1);
  const start = (currentPage - 1) * numPerPage;
  const end = start + numPerPage;

  const { metricDefaults } = useOrganizationMetricDefaults();
  const { ciUpper, ciLower } = useConfidenceLevels();
  const pValueThreshold = usePValueThreshold();

  const expData: MetricExperimentData[] = [];
  experimentsWithSnapshot.forEach((e) => {
    let variationResults: SnapshotMetric[][] = [];
    let statsEngine: StatsEngine = "bayesian";
    let differenceType: DifferenceType = "relative";
    if (e.snapshot) {
      const snapshot = e.snapshot.analyses?.[0];
      if (snapshot) {
        statsEngine = snapshot.settings.statsEngine;
        differenceType = snapshot.settings.differenceType;
        variationResults = snapshot.results?.[0]?.variations.map((v) => {
          return metrics.map((m) => v.metrics?.[m.id]);
        });
      }
    }
    const baseline = variationResults?.[0];
    const eVariations = getLatestPhaseVariations(e);
    eVariations.forEach((v, variationIndex) => {
      if (variationIndex === 0) return;
      const expVariationData: MetricExperimentData = {
        id: e.id,
        date: experimentDate(e),
        name: e.name,
        status: e.status,
        results: e.results,
        archived: e.archived,
        variations: eVariations,
        statsEngine: statsEngine,
        variationIndex: variationIndex,
        variationName: v.name,
        metricResults: [],
        phases: e.phases,
        goalMetrics: e.goalMetrics,
        guardrailMetrics: e.guardrailMetrics,
        secondaryMetrics: e.secondaryMetrics,
        datasource: e.datasource,
        decisionFrameworkSettings: e.decisionFrameworkSettings,
        users: undefined,
      };
      metrics.forEach((m, metricIndex) => {
        if (
          !bandits &&
          baseline?.[metricIndex] &&
          variationResults[variationIndex][metricIndex]
        ) {
          const { significant, resultsStatus, directionalStatus } =
            getMetricResultStatus({
              metric: m,
              metricDefaults,
              baseline: baseline[metricIndex],
              stats: variationResults[variationIndex][metricIndex],
              ciLower,
              ciUpper,
              pValueThreshold,
              statsEngine,
              differenceType,
            });
          const suspiciousChange = isSuspiciousUplift(
            baseline[metricIndex],
            variationResults[variationIndex][metricIndex],
            m,
            metricDefaults,
            differenceType,
          );
          const suspiciousThreshold =
            m.maxPercentChange ?? metricDefaults?.maxPercentageChange ?? 0;
          const minPercentChange =
            m.minPercentChange ?? metricDefaults.minPercentageChange ?? 0;
          expVariationData.metricResults.push({
            results: variationResults[variationIndex][metricIndex],
            significant,
            lift:
              variationResults[variationIndex][metricIndex].uplift?.mean ??
              undefined,
            resultsStatus,
            directionalStatus,
            suspiciousChange,
            suspiciousThreshold,
            minPercentChange,
          });
          expVariationData.users = Math.max(
            expVariationData.users ?? 0,
            variationResults[variationIndex][metricIndex].users,
          );
        }
      });
      expVariationData.shipped =
        e.results === "won" && e.winner === variationIndex;
      expData.push(expVariationData);
    });
  });

  const computedExpData = useAddComputedFields<
    MetricExperimentData,
    ComputedMetricExperimentData
  >(
    expData,
    (e) => {
      return {
        ...e,
        // Only show lift for first 2 metrics
        // TODO generalize to more metrics
        lift0: e.metricResults[0]?.lift,
        lift1: e.metricResults[1]?.lift,
        included: !excludedExperimentVariations.some(
          (ev) =>
            ev.experimentId === e.id && ev.variationIndex === e.variationIndex,
        ),
      };
    },
    [excludedExperimentVariations, metrics],
  );

  const { items, SortableTH } = useSearch({
    items: computedExpData,
    localStorageKey: "metricExperiments",
    defaultSortField: "date",
    defaultSortDir: -1,
    undefinedLast: true,
    searchFields: [],
  });

  const expRows = items.slice(start, end).map((e) => {
    return (
      <tr
        key={`${e.id}-${e.variationIndex}`}
        className="hover-highlight impact-results"
      >
        <td>
          <Checkbox
            value={
              !excludedExperimentVariations.some(
                (ev) =>
                  ev.experimentId === e.id &&
                  ev.variationIndex === e.variationIndex,
              )
            }
            setValue={(value) => {
              setExcludedExperimentVariations(
                value
                  ? excludedExperimentVariations.filter(
                      (ev) =>
                        ev.experimentId !== e.id ||
                        ev.variationIndex !== e.variationIndex,
                    )
                  : [
                      ...excludedExperimentVariations,
                      { experimentId: e.id, variationIndex: e.variationIndex },
                    ],
              );
            }}
          />
        </td>
        <td>
          <div className="my-1">
            <Link className="font-weight-bold" href={`/experiment/${e.id}`}>
              {e.name}
            </Link>
          </div>
        </td>

        <td>
          <div
            key={`var-experiment${e.id}-variation${e.variationIndex}`}
            className={`variation variation${e.variationIndex} with-variation-label d-flex my-1`}
          >
            <span className="label" style={{ width: 20, height: 20 }}>
              {e.variationIndex}
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
        {!bandits
          ? metrics.slice(0, 2).map((m, i) => {
              const mr = e.metricResults[i];
              if (!mr) return <td key={`${e.id}-${e.variationIndex}-${i}`} />;
              const resultsHighlightClassname = clsx(mr.resultsStatus, {
                "non-significant": !mr.significant,
                hover: false,
              });
              return (
                <ChangeColumn
                  metric={m}
                  stats={mr.results}
                  rowResults={{
                    enoughData: true,
                    directionalStatus: mr.directionalStatus ?? "losing",
                    hasScaledImpact: true,
                    significant: mr.significant,
                    resultsStatus:
                      (mr.resultsStatus as RowResults["resultsStatus"]) ?? "",
                    suspiciousChange: mr.suspiciousChange,
                    suspiciousThreshold: mr.suspiciousThreshold,
                    minPercentChange: mr.minPercentChange,
                    currentMetricTotal: mr.results?.value ?? 0,
                  }}
                  showPlusMinus={false}
                  statsEngine={e.statsEngine}
                  differenceType={differenceType}
                  showCI={true}
                  className={resultsHighlightClassname}
                  key={`${e.id}-${e.variationIndex}-${i}`}
                />
              );
            })
          : null}
      </tr>
    );
  });

  return (
    <div>
      <table className="table appbox">
        <thead className="bg-light">
          <tr>
            <SortableTH field="included">Include</SortableTH>
            <SortableTH field="name">Experiment</SortableTH>
            <SortableTH field="variationIndex">Variation</SortableTH>
            <SortableTH field="date">Date</SortableTH>
            <SortableTH field="status">Status</SortableTH>
            <SortableTH field="users">Variation Users</SortableTH>
            {metrics[0] && (
              <SortableTH field="lift0">Lift {metrics[0].name}</SortableTH>
            )}
            {metrics[1] && (
              <SortableTH field="lift1">Lift {metrics[1].name}</SortableTH>
            )}
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
};

export default ExperimentWithMetricsTable;
