import { FC, useCallback, useMemo, useState } from "react";
import { AlertDialog, Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { extent } from "@visx/vendor/d3-array";
import { scaleTime } from "@visx/scale";
import { ParentSizeModern } from "@visx/responsive";
import { localPoint } from "@visx/event";
import {
  MetricTimeSeries,
  MetricTimeSeriesDataPoint,
  RampEvent,
  RampScheduleInterface,
} from "shared/validators";
import { getValidDate } from "shared/dates";
import {
  filterInvalidMetricTimeSeries,
  getSafeRolloutSnapshotAnalysis,
} from "shared/util";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { SafeRolloutSnapshotInterface } from "shared/types/safe-rollout";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  getMetricLink,
  isBinomialMetric,
  isFactMetric,
} from "shared/experiments";
import {
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  SAFE_ROLLOUT_VARIATIONS,
} from "shared/constants";
import { getSRMHealthData, getMultipleExposureHealthData } from "shared/health";
import { PiInfo, PiLightning, PiLightningSlash } from "react-icons/pi";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { ExperimentTableRow, getRowResults } from "@/services/experiments";
import SafeRolloutTimeSeriesGraph, {
  TimeSeriesEventMarker,
} from "@/components/Experiment/SafeRolloutTimeSeriesGraph";
import StatusColumn from "@/components/SafeRollout/Results/StatusColumn";
import MetricName from "@/components/Metrics/MetricName";
import Tooltip from "@/components/Tooltip/Tooltip";
import VariationUsersTable from "@/components/Experiment/TabbedPage/VariationUsersTable";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import Metadata from "@/ui/Metadata";
import { ExperimentReportVariation } from "shared/types/report";
import Modal from "@/components/Modal";
import MetricDrilldownOverview from "@/components/MetricDrilldown/MetricDrilldownOverview";

// ─── Dummy data helpers ──────────────────────────────────────────────────────

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const STEP_EVENT_TYPES = new Set([
  "started",
  "step-advanced",
  "step-jumped",
  "rollback",
  "reset",
  "completed",
]);

function stepLabel(idx: number | undefined): string {
  return idx !== undefined && idx >= 0 ? String(idx + 1) : "?";
}

function isRegressionEvent(e: RampEvent): boolean {
  if (e.type === "rollback" || e.type === "reset") return true;
  if (
    e.type === "step-jumped" &&
    e.stepIndex !== undefined &&
    e.previousStepIndex !== undefined &&
    e.stepIndex < e.previousStepIndex
  )
    return true;
  return false;
}

function eventLabel(e: RampEvent): string {
  switch (e.type) {
    case "started":
      return "Start";
    case "step-advanced":
      return `S${stepLabel(e.stepIndex)}`;
    case "step-jumped":
      return `S${stepLabel(e.stepIndex)}`;
    case "rollback":
      return e.stepIndex === -1 ? "Rollback" : `S${stepLabel(e.stepIndex)}`;
    case "reset":
      return "Reset";
    case "completed":
      return "Done";
    default:
      return e.type;
  }
}

function eventTooltip(e: RampEvent): React.ReactNode {
  const ts = getValidDate(e.timestamp);
  const time = ts.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  let action: string;
  switch (e.type) {
    case "started":
      action = "Started";
      break;
    case "step-advanced":
      action = `Advanced to Step ${stepLabel(e.stepIndex)}`;
      break;
    case "step-jumped":
      action =
        e.previousStepIndex !== undefined &&
        e.stepIndex !== undefined &&
        e.stepIndex < e.previousStepIndex
          ? `Jumped back to Step ${stepLabel(e.stepIndex)}`
          : `Jumped to Step ${stepLabel(e.stepIndex)}`;
      break;
    case "rollback":
      action =
        e.stepIndex === -1
          ? "Rolled back"
          : `Rolled back to Step ${stepLabel(e.stepIndex)}`;
      break;
    case "reset":
      action = "Reset";
      break;
    case "completed":
      action = "Completed";
      break;
    default:
      action = e.type;
  }
  return (
    <span>
      <strong>{action}</strong> — {time}
    </span>
  );
}

const EVENT_PRIORITY: Record<string, number> = {
  started: 0,
  completed: 1,
  rollback: 2,
  reset: 3,
  "step-jumped": 4,
  "step-advanced": 5,
};

const DEDUP_THRESHOLD_MS = 5_000;

type MarkerWithPriority = Omit<TimeSeriesEventMarker, "tooltips"> & {
  tooltips: React.ReactNode[];
  _priority: number;
};

function buildEventMarkers(events: RampEvent[]): MarkerWithPriority[] {
  const raw: MarkerWithPriority[] = events
    .filter((e) => STEP_EVENT_TYPES.has(e.type))
    .map((e) => ({
      date: getValidDate(e.timestamp),
      label: eventLabel(e),
      color: isRegressionEvent(e) ? ("red" as const) : ("indigo" as const),
      tooltips: [eventTooltip(e)],
      _priority: EVENT_PRIORITY[e.type] ?? 99,
    }));

  const deduped: MarkerWithPriority[] = [];
  for (const m of raw) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      Math.abs(m.date.getTime() - prev.date.getTime()) < DEDUP_THRESHOLD_MS
    ) {
      const merged = m._priority < prev._priority ? { ...m } : { ...prev };
      merged.tooltips = [...(prev.tooltips ?? []), ...(m.tooltips ?? [])];
      deduped[deduped.length - 1] = merged;
    } else {
      deduped.push(m);
    }
  }
  return deduped;
}

function EventMarkerLabels({
  markers,
  dateExtent,
}: {
  markers: TimeSeriesEventMarker[];
  dateExtent: [Date, Date] | [undefined, undefined];
}) {
  const [hovered, setHovered] = useState<{
    marker: TimeSeriesEventMarker;
    x: number;
  } | null>(null);

  if (!dateExtent[0] || !dateExtent[1]) return null;

  const [d0, d1] = dateExtent;
  const timeRange = d1.getTime() - d0.getTime();
  const xPad = timeRange * 0.05;

  return (
    <ParentSizeModern>
      {({ width }) => {
        const xScale = scaleTime<number>({
          domain: [
            new Date(d0.getTime() - xPad),
            new Date(d1.getTime() + xPad),
          ],
          range: [0, width],
        });

        const markerXs = markers.map((m) => xScale(m.date));

        const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
          const point = localPoint(e);
          if (!point) return;
          let closest = 0;
          let closestDist = Infinity;
          for (let i = 0; i < markerXs.length; i++) {
            const d = Math.abs(markerXs[i] - point.x);
            if (d < closestDist) {
              closestDist = d;
              closest = i;
            }
          }
          if (closestDist < 30) {
            setHovered({ marker: markers[closest], x: markerXs[closest] });
          } else {
            setHovered(null);
          }
        };

        return (
          <div style={{ position: "relative" }}>
            <svg
              width={width}
              height={20}
              style={{ display: "block" }}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHovered(null)}
            >
              {markers.map((m, i) => {
                const x = markerXs[i];
                if (x < 0 || x > width) return null;
                const isRed = m.color === "red";
                const lineStroke = isRed ? "var(--red-a5)" : "var(--indigo-a5)";
                const labelFill = isRed ? "var(--red-11)" : "var(--indigo-11)";
                const labelX = Math.max(10, Math.min(x, width - 10));
                const anchor = x <= 0 ? "start" : x >= width ? "end" : "middle";
                return (
                  <g key={i}>
                    <line
                      x1={x}
                      y1={0}
                      x2={x}
                      y2={6}
                      stroke={lineStroke}
                      strokeWidth={1}
                    />
                    <text
                      x={labelX}
                      y={17}
                      fontSize={9}
                      fill={labelFill}
                      textAnchor={anchor}
                    >
                      {m.label}
                    </text>
                  </g>
                );
              })}
            </svg>
            {hovered && (
              <div
                style={{
                  position: "absolute",
                  bottom: "100%",
                  left: hovered.x,
                  transform: "translateX(-50%)",
                  marginBottom: 4,
                  pointerEvents: "none",
                  zIndex: 1100,
                  backgroundColor: "var(--color-panel-solid)",
                  boxShadow: "var(--shadow-5)",
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontSize: 12,
                  lineHeight: 1.4,
                  whiteSpace: "nowrap",
                }}
              >
                {hovered.marker.tooltips?.map((t, i) => (
                  <div key={i}>{t}</div>
                ))}
              </div>
            )}
          </div>
        );
      }}
    </ParentSizeModern>
  );
}

function emptyTimeSeries(metricId: string): MetricTimeSeries {
  return {
    id: "",
    organization: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    metricId,
    source: "safe-rollout",
    sourceId: "",
    lastExperimentSettingsHash: "",
    lastMetricSettingsHash: "",
    dataPoints: [],
  };
}

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

type DummyScenario = "passing" | "failing" | "nodata";

/** Proportion / binomial-style rates stay in (0,1); revenue-like metrics need currency-scale means or Value shows ¥0. */
function dummyPerUnitMeanAndTotal(
  metricId: string,
  users: number,
  rand: () => number,
  getExperimentMetricById?: (id: string) => ExperimentMetricInterface | null,
): { mean: number; total: number } {
  const metric = getExperimentMetricById?.(metricId);
  if (metric && !isBinomialMetric(metric)) {
    const mean = 50 + rand() * 350;
    return { mean, total: mean * users };
  }
  const mean = 0.02 + rand() * 0.15;
  return { mean, total: mean * users };
}

function generateDummySnapshotMetrics(
  metricIds: string[],
  scenarios: DummyScenario[],
  isInverseMetric: (metricId: string) => boolean = () => false,
  getExperimentMetricById?: (id: string) => ExperimentMetricInterface | null,
): Record<string, { baseline: SnapshotMetric; variation: SnapshotMetric }> {
  const result: Record<
    string,
    { baseline: SnapshotMetric; variation: SnapshotMetric }
  > = {};
  metricIds.forEach((id, idx) => {
    const rand = seededRandom(hashString(id));
    const scenario = scenarios[idx % scenarios.length];
    const baseUsers = 800 + Math.floor(rand() * 4000);
    const { mean: baseCr, total: baseValue } = dummyPerUnitMeanAndTotal(
      id,
      baseUsers,
      rand,
      getExperimentMetricById,
    );

    const baseline: SnapshotMetric = {
      value: baseValue,
      cr: baseCr,
      users: baseUsers,
      // Match one-sided frequentist style (safe rollouts use oneSidedIntervals)
      ci: [-Infinity, 0.05],
      expected: 0,
      pValue: 1,
    };

    if (scenario === "nodata") {
      result[id] = {
        baseline: { value: 0, cr: 0, users: 12 },
        variation: { value: 0, cr: 0, users: 8 },
      };
      return;
    }

    const varUsers = baseUsers + Math.floor((rand() - 0.5) * 200);
    let effect: number;
    let pValue: number;
    if (scenario === "failing") {
      effect = -(0.04 + rand() * 0.08);
      pValue = 0.001 + rand() * 0.03;
    } else {
      effect = (rand() - 0.5) * 0.04;
      pValue = 0.15 + rand() * 0.7;
    }
    const varCr = baseCr * (1 + effect);
    const varValue = varUsers * varCr;
    // For failing: CI should not cross zero (significant), so ciHalf < |effect|
    // For passing: CI can be wide (non-significant)
    const ciHalf =
      scenario === "failing"
        ? Math.abs(effect) * (0.3 + rand() * 0.5)
        : Math.abs(effect) * (1.5 + rand() * 2);

    const inverse = isInverseMetric(id);
    const variation: SnapshotMetric = {
      value: varValue,
      cr: varCr,
      users: varUsers,
      ci: inverse
        ? ([effect - ciHalf, Infinity] as [number, number])
        : ([-Infinity, effect + ciHalf] as [number, number]),
      expected: effect,
      pValue,
    };

    result[id] = { baseline, variation };
  });
  return result;
}

function generateDummyTimeSeries(
  metricIds: string[],
  scenarios: DummyScenario[],
  snapshotMetrics?: Record<
    string,
    { baseline: SnapshotMetric; variation: SnapshotMetric }
  >,
  startMs?: number,
): MetricTimeSeries[] {
  const now = Date.now();
  const threeDaysAgo = startMs ?? now - 3 * 24 * 60 * 60 * 1000;
  const pointCount = 20;

  return metricIds.map((metricId, idx) => {
    const rand = seededRandom(hashString(metricId) + 999);
    const scenario = scenarios[idx % scenarios.length];
    const baseCr =
      snapshotMetrics?.[metricId]?.baseline?.cr ??
      0.02 + rand() * 0.15;

    // Use snapshot's final effect so the time series endpoint matches the table
    const snapshotEffect =
      snapshotMetrics?.[metricId]?.variation?.expected ?? 0;

    const dataPoints: MetricTimeSeriesDataPoint[] = [];
    if (scenario === "nodata") {
      return {
        id: `dummy-ts-${metricId}`,
        organization: "dummy",
        dateCreated: new Date(threeDaysAgo),
        dateUpdated: new Date(now),
        metricId,
        source: "safe-rollout" as const,
        sourceId: "dummy",
        lastExperimentSettingsHash: "",
        lastMetricSettingsHash: "",
        dataPoints: [],
      };
    }
    for (let p = 0; p < pointCount; p++) {
      const date = new Date(
        threeDaysAgo + (p / (pointCount - 1)) * (now - threeDaysAgo),
      );
      const progress = p / pointCount;

      const effect =
        scenario === "failing"
          ? snapshotEffect * progress + (rand() - 0.5) * 0.01
          : (rand() - 0.5) * 0.015;

      const pVal =
        scenario === "failing"
          ? Math.max(0.001, 0.5 - progress * 0.45 + (rand() - 0.5) * 0.1)
          : 0.2 + rand() * 0.6;

      const ciMargin =
        scenario === "failing"
          ? 0.04 / Math.sqrt(0.5 + progress * 5)
          : 0.03 / Math.sqrt(0.5 + progress * 5);

      // One-sided CI: [-Infinity, upperBound]
      const ciBound = effect + ciMargin;

      dataPoints.push({
        date,
        variations: [
          {
            id: "0",
            name: "Control",
            stats: {
              users: 100 + p * 50,
              mean: baseCr,
              stddev: baseCr * 0.3,
            },
          },
          {
            id: "1",
            name: "Rollout Value",
            stats: {
              users: 98 + p * 48,
              mean: baseCr * (1 + effect),
              stddev: baseCr * 0.3,
            },
            relative: {
              value: effect,
              ci: [-Infinity, ciBound] as [number, number],
              pValue: pVal,
              expected: effect,
            },
            absolute: {
              value: effect,
              ci: [-Infinity, ciBound] as [number, number],
              pValue: pVal,
              expected: effect,
            },
          },
        ],
      });
    }

    return {
      id: `dummy-ts-${metricId}`,
      organization: "dummy",
      dateCreated: new Date(threeDaysAgo),
      dateUpdated: new Date(now),
      metricId,
      source: "safe-rollout" as const,
      sourceId: "dummy",
      lastExperimentSettingsHash: "",
      lastMetricSettingsHash: "",
      dataPoints,
    };
  });
}

function generateDummyTrafficSnapshot(): SafeRolloutSnapshotInterface {
  const treatmentUsers = 4821;
  const controlUsers = 5203;
  return {
    id: "srsnp_dummy",
    organization: "",
    safeRolloutId: "",
    dateCreated: new Date(),
    runStarted: new Date(),
    status: "success",
    queries: [],
    multipleExposures: 347,
    analyses: [],
    health: {
      traffic: {
        overall: {
          name: "All",
          srm: 0.42,
          variationUnits: [treatmentUsers, controlUsers],
        },
        dimension: {},
      },
    },
    settings: {
      datasourceId: "",
      exposureQueryId: "",
      startDate: new Date(),
      metricSettings: [],
    },
  } as unknown as SafeRolloutSnapshotInterface;
}

// ─── Metric drilldown modal (safe-rollout-specific) ──────────────────────────

function SafeRolloutMetricDrilldownModal({
  row,
  resultGroup,
  guardrailMetricIds,
  signalMetricIds,
  timeSeries,
  reportDate,
  startDate,
  close,
}: {
  row: ExperimentTableRow;
  resultGroup: "guardrail" | "secondary";
  guardrailMetricIds: string[];
  signalMetricIds: string[];
  timeSeries?: MetricTimeSeries;
  reportDate: Date;
  startDate: Date;
  close: () => void;
}) {
  const { metric } = row;
  const variations = useMemo(
    (): ExperimentReportVariation[] =>
      SAFE_ROLLOUT_VARIATIONS.map((v) => ({ ...v })),
    [],
  );

  return (
    <Modal
      open={true}
      header={<MetricName metric={metric} officialBadgePosition="right" />}
      subHeader={
        metric.description ? (
          <Text as="div" size="small" color="text-mid">
            {metric.description}
          </Text>
        ) : undefined
      }
      close={close}
      size="max"
      cta="Close"
      submit={close}
      autoFocusSelector=""
      trackingEventModalType="safe-rollout-metric-drilldown"
    >
      <MetricDrilldownOverview
        row={row}
        experimentId=""
        significanceThresholds={{
          pValueThreshold: 0.05,
          bayesianConfidenceLevels: {
            ciUpper: 0.975,
            ciLower: 0.025,
            ciUpperDisplay: "97.5%",
            ciLowerDisplay: "2.5%",
          },
        }}
        reportDate={reportDate}
        isLatestPhase={true}
        phase={0}
        startDate={startDate.toISOString()}
        endDate={new Date().toISOString()}
        experimentStatus="running"
        variations={variations}
        localBaselineRow={0}
        setLocalBaselineRow={() => {}}
        localVariationFilter={undefined}
        setLocalVariationFilter={() => {}}
        goalMetrics={[]}
        secondaryMetrics={resultGroup === "secondary" ? signalMetricIds : []}
        statsEngine="frequentist"
        localDifferenceType="relative"
        setLocalDifferenceType={() => {}}
        preloadedTimeSeries={timeSeries}
      />
    </Modal>
  );
}

// ─── Metric section (table-based, matching experiment results UI) ─────────────

const SAFE_ROLLOUT_STATUS_LABELS = {
  won: "Within bounds",
  lost: "Failing",
  draw: "Within bounds",
  insignificant: "Within bounds",
  notEnoughData: "Not enough data",
  badgeColor: "var(--blue-a7)",
};

function MetricSection({
  title,
  subtitle,
  metricIds,
  resultGroup,
  snapshotMetrics,
  timeSeries,
  dateExtent,
  reportDate,
  startDate,
  eventMarkers,
  guardrailMetricIds,
  signalMetricIds,
}: {
  title: string;
  subtitle: string;
  metricIds: string[];
  resultGroup: "guardrail" | "secondary";
  snapshotMetrics: Record<
    string,
    { baseline: SnapshotMetric; variation: SnapshotMetric }
  >;
  timeSeries: Record<string, MetricTimeSeries>;
  dateExtent: [Date, Date] | [undefined, undefined];
  reportDate: Date;
  startDate: Date;
  eventMarkers?: TimeSeriesEventMarker[];
  guardrailMetricIds: string[];
  signalMetricIds: string[];
}) {
  const { getExperimentMetricById } = useDefinitions();
  const { metricDefaults, getMinSampleSizeForMetric } =
    useOrganizationMetricDefaults();

  const rows = useMemo(() => {
    return metricIds
      .map((metricId): ExperimentTableRow | null => {
        const metric = getExperimentMetricById(metricId);
        if (!metric) return null;
        const data = snapshotMetrics[metricId];
        return {
          label: metric.name,
          metric,
          metricOverrideFields: [],
          variations: data
            ? [data.baseline, data.variation]
            : [
                { value: 0, cr: 0, users: 0 },
                { value: 0, cr: 0, users: 0 },
              ],
          resultGroup,
        };
      })
      .filter(Boolean) as ExperimentTableRow[];
  }, [metricIds, snapshotMetrics, getExperimentMetricById, resultGroup]);

  const allRowResults = useMemo(() => {
    return rows.map((row) => {
      const baseline = row.variations[0] || { value: 0, cr: 0, users: 0 };
      const stats = row.variations[1] || { value: 0, cr: 0, users: 0 };
      const denominator =
        !isFactMetric(row.metric) && row.metric.denominator
          ? (getExperimentMetricById(row.metric.denominator) ?? undefined)
          : undefined;
      return getRowResults({
        stats,
        baseline,
        metric: row.metric,
        denominator,
        metricDefaults,
        minSampleSize: getMinSampleSizeForMetric(row.metric),
        statsEngine: "frequentist",
        differenceType: "relative",
        ciUpper: 0.975,
        ciLower: 0.025,
        pValueThreshold: 0.05,
        snapshotDate: reportDate,
        phaseStartDate: startDate,
        isLatestPhase: true,
        experimentStatus: "running",
      });
    });
  }, [
    rows,
    metricDefaults,
    getMinSampleSizeForMetric,
    getExperimentMetricById,
    reportDate,
    startDate,
  ]);

  const [drilldownRowIndex, setDrilldownRowIndex] = useState<number | null>(
    null,
  );

  if (rows.length === 0) return null;

  const ROW_HEIGHT = 55;

  return (
    <Box>
      <Text as="div" weight="medium" size="medium" mb="1">
        {title}
      </Text>
      <Text as="div" size="small" color="text-low" mb="2">
        {subtitle}
      </Text>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 600 }}>
          <table className="experiment-results table-sm">
            <thead>
              <tr className="results-top-row">
                <th
                  className="axis-col noStickyHeader label"
                  style={{ width: 280, whiteSpace: "nowrap" }}
                >
                  Metric
                </th>
                <th className="axis-col noStickyHeader label">
                  Metric Boundary
                </th>
                <th
                  className="axis-col noStickyHeader label"
                  style={{ width: 200, whiteSpace: "nowrap" }}
                >
                  Status
                  <Tooltip
                    usePortal
                    tipPosition="top"
                    body={
                      <>
                        <Text as="div" mb="2">
                          Guardrails are either <strong>within bounds</strong>{" "}
                          or <strong>failing</strong>. Once statistically
                          significant in the undesirable direction, the status
                          changes to <strong>failing</strong>.
                        </Text>
                        <Text as="div">
                          Safe rollouts use frequentist sequential testing to
                          detect and revert issues early without increasing
                          false positive rates.
                        </Text>
                      </>
                    }
                  >
                    <PiInfo color="var(--color-text-low)" className="ml-1" />
                  </Tooltip>
                </th>
              </tr>
            </thead>

            {rows.map((row, i) => {
              const baseline = row.variations[0] || {
                value: 0,
                cr: 0,
                users: 0,
              };
              const stats = row.variations[1] || { value: 0, cr: 0, users: 0 };
              const rr = allRowResults[i];
              const metricTs = timeSeries[row.metric.id];
              const isInverse = !!row.metric.inverse;

              const hasData = rr.enoughData || (stats.users ?? 0) > 0;

              return (
                <tbody className="results-group-row" key={row.metric.id}>
                  <tr
                    className={`results-variation-row results-metric-row${hasData ? " results-clickable-row" : ""}`}
                    onClick={
                      hasData
                        ? () => setDrilldownRowIndex(i)
                        : undefined
                    }
                  >
                    {/* Metric label */}
                    <td
                      className="variation with-variation-label"
                      style={{ width: 280 }}
                    >
                      <div
                        className="d-flex align-items-center"
                        style={{ minHeight: ROW_HEIGHT }}
                      >
                        <span
                          className="font-weight-bold metric-label text-ellipsis"
                          style={{
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            lineHeight: "1.2em",
                          }}
                        >
                          <Link
                            href={getMetricLink(row.metric.id)}
                            className="metriclabel text-dark"
                          >
                            <MetricName
                              metric={row.metric}
                              disableTooltip
                              officialBadgeLeftGap={false}
                            />
                          </Link>
                        </span>
                      </div>
                    </td>

                    {/* Time series sparkline */}
                    <td style={{ padding: 0 }}>
                      <div style={{ height: ROW_HEIGHT, minWidth: 250 }}>
                        <SafeRolloutTimeSeriesGraph
                          data={metricTs ?? emptyTimeSeries(row.metric.id)}
                          xDateRange={dateExtent}
                          inverse={isInverse}
                          eventMarkers={eventMarkers}
                        />
                      </div>
                    </td>

                    {/* Status */}
                    <td className="variation chance">
                      <div
                        className="d-flex align-items-center"
                        style={{
                          minHeight: ROW_HEIGHT,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <StatusColumn
                          stats={stats}
                          baseline={baseline}
                          rowResults={rr}
                        />
                      </div>
                    </td>
                  </tr>
                </tbody>
              );
            })}

            {/* Shared event marker row */}
            {eventMarkers && eventMarkers.length > 0 && (
              <tfoot>
                <tr style={{ height: 20 }}>
                  <td />
                  <td style={{ padding: 0 }}>
                    <div style={{ height: 20, position: "relative" }}>
                      <EventMarkerLabels
                        markers={eventMarkers}
                        dateExtent={dateExtent}
                      />
                    </div>
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {drilldownRowIndex !== null && rows[drilldownRowIndex] && (
        <SafeRolloutMetricDrilldownModal
          row={rows[drilldownRowIndex]}
          resultGroup={resultGroup}
          guardrailMetricIds={guardrailMetricIds}
          signalMetricIds={signalMetricIds}
          timeSeries={timeSeries[rows[drilldownRowIndex].metric.id]}
          reportDate={reportDate}
          startDate={startDate}
          close={() => setDrilldownRowIndex(null)}
        />
      )}
    </Box>
  );
}

// ─── Health checks ───────────────────────────────────────────────────────────

const numberFmt = Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const pctFmt = Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

type SRMHealthStatus = "healthy" | "unhealthy" | "not-enough-traffic";

function pValueFmt(p: number): string {
  if (typeof p !== "number") return "";
  return p < 0.001 ? "<0.001" : p.toFixed(3);
}

function HealthChecks({
  snapshot,
}: {
  snapshot: SafeRolloutSnapshotInterface | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const [srmModalOpen, setSrmModalOpen] = useState(false);
  const { settings } = useUser();

  const traffic = snapshot?.health?.traffic;
  const units = traffic?.overall?.variationUnits;
  const srmPValue = traffic?.overall?.srm;
  const totalUsers = units?.reduce((a, b) => a + b, 0) ?? 0;
  const meCount = snapshot?.multipleExposures ?? 0;

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;
  const meMinPercent =
    settings.multipleExposureMinPercent ?? DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD;

  const srmHealth: SRMHealthStatus = useMemo(() => {
    if (srmPValue === undefined || totalUsers === 0)
      return "not-enough-traffic";
    return getSRMHealthData({
      srm: srmPValue,
      srmThreshold,
      numOfVariations: 2,
      totalUsersCount: totalUsers,
      minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
    });
  }, [srmPValue, srmThreshold, totalUsers]);

  const meHealth = useMemo(
    () =>
      getMultipleExposureHealthData({
        multipleExposuresCount: meCount,
        totalUsersCount: totalUsers,
        minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
        minPercentThreshold: meMinPercent,
      }),
    [meCount, totalUsers, meMinPercent],
  );

  const hasData = !!units && totalUsers > 0;

  const hasIssue = srmHealth === "unhealthy" || meHealth.status === "unhealthy";

  const overallColor = !hasData
    ? "var(--slate-11)"
    : hasIssue
      ? "var(--amber-11)"
      : "var(--blue-11)";
  const overallBg = !hasData
    ? "var(--slate-a3)"
    : hasIssue
      ? "var(--amber-a3)"
      : "var(--blue-a3)";
  const overallLabel = !hasData
    ? "Awaiting data"
    : hasIssue
      ? "Issues detected"
      : "All clear";

  const variations = [
    { name: "Treatment", expected: 0.5 },
    { name: "Control", expected: 0.5 },
  ];

  return (
    <Box mt="3">
      {/* SRM Learn More dialog */}
      {srmModalOpen && (
        <AlertDialog.Root open={true}>
          <AlertDialog.Content maxWidth="720px">
            <Flex direction="column" gap="4">
              <Box>
                <AlertDialog.Title>
                  <Text as="div" size="x-large" weight="medium">
                    Sample Ratio Mismatch (SRM)
                  </Text>
                </AlertDialog.Title>
                <AlertDialog.Description>
                  <Text as="div" size="medium" color="text-low">
                    When actual traffic splits are significantly different from
                    expected, we raise an SRM issue.
                  </Text>
                </AlertDialog.Description>
              </Box>

              {srmHealth !== "unhealthy" ? (
                <Callout status="info">
                  There is not enough evidence to raise an issue. Any imbalances
                  in the percentages you see may be due to chance and
                  aren&apos;t cause for concern at this time.
                </Callout>
              ) : (
                <Callout status="warning">
                  The threshold for firing an SRM warning is{" "}
                  <b>{srmThreshold}</b> and the p-value is{" "}
                  <b>{srmPValue !== undefined ? pValueFmt(srmPValue) : "—"}</b>.
                  This is a strong indicator that your traffic is imbalanced.
                </Callout>
              )}

              {hasData && (
                <VariationUsersTable
                  variations={variations.map((v, i) => ({
                    id: String(i),
                    name: v.name,
                    weight: v.expected,
                    index: i,
                  }))}
                  users={units ? [...units] : []}
                  srm={srmPValue}
                  hideVariationIndex
                />
              )}

              {srmHealth === "unhealthy" && (
                <Box>
                  <Text as="div" size="small" mb="2">
                    Most common causes:
                  </Text>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>
                      <Text size="small">
                        Broken event firing or SDK trackingCallback issues
                      </Text>
                    </li>
                    <li>
                      <Text size="small">
                        Mismatch between SDK attribute and data ID
                      </Text>
                    </li>
                    <li>
                      <Text size="small">
                        Coverage or targeting changes mid-rollout
                      </Text>
                    </li>
                    <li>
                      <Text size="small">
                        Step jumps that re-randomize traffic
                      </Text>
                    </li>
                  </ul>
                  <Text as="div" size="small" mt="2">
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href="https://docs.growthbook.io/kb/experiments/troubleshooting-experiments"
                    >
                      Read about troubleshooting in our docs
                    </a>
                  </Text>
                </Box>
              )}

              <Flex justify="end">
                <Link onClick={() => setSrmModalOpen(false)}>Close</Link>
              </Flex>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      )}

      {/* Accordion header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setExpanded(!expanded);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <Text size="medium" weight="medium">
          {expanded ? "▾" : "▸"} Health Checks
        </Text>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: overallColor,
            backgroundColor: overallBg,
            borderRadius: "var(--radius-1)",
            padding: "1px 6px",
          }}
        >
          {overallLabel}
        </span>
      </div>

      {expanded && (
        <Box mt="2">
          {!hasData ? (
            <Text as="div" size="small" color="text-low">
              No traffic data available yet. Data will appear after the first
              snapshot completes.
            </Text>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 20,
                fontSize: 13,
              }}
            >
              {/* ── 1. Total Users ── */}
              <div>
                Total Users: <strong>{numberFmt.format(totalUsers)}</strong>
              </div>

              {/* ── 2. Experiment Balance (SRM) ── */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  Experiment Balance
                </div>
                <table
                  className="table-sm"
                  style={{
                    width: "100%",
                    maxWidth: 460,
                    borderCollapse: "collapse",
                  }}
                >
                  <thead>
                    <tr>
                      {["Variation", "Users", "Actual", "Expected"].map((h) => (
                        <th
                          key={h}
                          style={{
                            fontWeight: 500,
                            width: "25%",
                            padding: "6px 8px",
                            borderBottom: "1px solid var(--slate-a5)",
                            textAlign: "left",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {variations.map((v, i) => {
                      const actual = units[i] ?? 0;
                      const actualPct =
                        totalUsers > 0 ? actual / totalUsers : 0;
                      const isOff = Math.abs(actualPct - v.expected) > 0.02;
                      return (
                        <tr key={i}>
                          <td style={{ padding: "6px 8px" }}>{v.name}</td>
                          <td style={{ padding: "6px 8px" }}>
                            {numberFmt.format(actual)}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              color: isOff ? "var(--red-11)" : undefined,
                            }}
                          >
                            {pctFmt.format(actualPct)}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              color: "var(--slate-11)",
                            }}
                          >
                            {pctFmt.format(v.expected)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ marginTop: 8 }}>
                  {srmHealth === "unhealthy" ? (
                    <Callout status="warning" size="sm">
                      <strong>Sample Ratio Mismatch (SRM) detected.</strong>{" "}
                      P-value {pValueFmt(srmPValue!)} is below {srmThreshold}.{" "}
                      <a
                        className="a"
                        role="button"
                        onClick={() => setSrmModalOpen(true)}
                      >
                        Learn More {">"}
                      </a>
                    </Callout>
                  ) : (
                    <Callout status="success" size="sm">
                      No Sample Ratio Mismatch (SRM) detected.
                      {srmHealth === "healthy" && (
                        <> P-value above {srmThreshold}.</>
                      )}{" "}
                      <a
                        className="a"
                        role="button"
                        onClick={() => setSrmModalOpen(true)}
                      >
                        Learn More {">"}
                      </a>
                    </Callout>
                  )}
                </div>
              </div>

              {/* ── 3. Multiple Exposures ── */}
              {meHealth.status !== "not-enough-traffic" && (
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    Multiple Exposures
                  </div>
                  <div>
                    {numberFmt.format(meCount)} users (
                    {pctFmt.format(meHealth.rawDecimal)})
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {meHealth.status === "unhealthy" ? (
                      <Callout status="warning" size="sm">
                        <strong>Multiple Exposures Warning.</strong>{" "}
                        {numberFmt.format(meCount)} users saw multiple
                        variations. Check for bugs in your implementation, event
                        tracking, or data pipeline.
                      </Callout>
                    ) : (
                      <Callout status="success" size="sm">
                        {meCount === 0
                          ? "No multiple exposures detected."
                          : `${numberFmt.format(meCount)} multiple exposures detected, below the ${pctFmt.format(meMinPercent)} threshold.`}
                      </Callout>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </Box>
      )}
    </Box>
  );
}

// ─── Monitoring controls ─────────────────────────────────────────────────────

function getMonitoringInactiveReason(
  rampSchedule: RampScheduleInterface,
): string | null {
  const { status, currentStepIndex, steps } = rampSchedule;
  if (status === "paused") return "Monitoring paused — ramp is paused";
  if (status === "completed") return "Monitoring stopped — ramp is complete";
  if (status === "rolled-back")
    return "Monitoring stopped — ramp was rolled back";
  if (status === "pending" || status === "ready")
    return "Monitoring inactive — ramp has not started";
  if (status === "pending-approval")
    return "Monitoring paused — awaiting approval";
  const step = steps[currentStepIndex];
  if (step && !step.monitored)
    return "Monitoring inactive — current step is not monitored";
  return null;
}

function MonitoringControls({
  rampSchedule,
  safeRolloutId,
  snapshot,
  latest,
  mutateSnapshot,
}: {
  rampSchedule: RampScheduleInterface;
  safeRolloutId: string;
  snapshot?: SafeRolloutSnapshotInterface;
  latest?: SafeRolloutSnapshotInterface;
  mutateSnapshot: () => void;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const snapshotCtx = useSafeRolloutSnapshot();

  const { getDatasourceById } = useDefinitions();
  const safeRollout = snapshotCtx.safeRollout;

  // Fetch the SafeRollout directly when the provider doesn't have it
  // (ramp-backed SRs may not be in the safeRolloutsMap that feeds the provider)
  const { data: srData, mutate: mutateSr } = useApi<{
    safeRollout: {
      id: string;
      autoSnapshots?: boolean;
      datasourceId?: string;
      nextSnapshotAttempt?: string | Date;
    };
  }>(`/safe-rollout/${safeRolloutId}`, {
    shouldRun: () => !safeRollout && !!safeRolloutId,
  });
  const srFromApi = useMemo(() => {
    if (safeRollout) return safeRollout;
    return srData?.safeRollout as typeof safeRollout | undefined;
  }, [safeRollout, srData]);

  const autoSnapshots = srFromApi?.autoSnapshots ?? true;
  const datasourceId =
    srFromApi?.datasourceId ??
    snapshot?.settings?.datasourceId ??
    rampSchedule.monitoringConfig?.datasourceId;

  const inactiveReason = getMonitoringInactiveReason(rampSchedule);
  const isMonitoringActive = !inactiveReason;

  const [queriesModalOpen, setQueriesModalOpen] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const latestSnap = latest ?? snapshot;

  const queryStatusData = useMemo(() => {
    if (!latestSnap) return null;
    return getQueryStatus(latestSnap.queries, latestSnap.error);
  }, [latestSnap]);

  const status = queryStatusData?.status ?? "succeeded";
  const ds = datasourceId ? getDatasourceById(datasourceId) : null;
  const canRunQueries = ds
    ? permissionsUtil.canRunExperimentQueries(ds)
    : !!datasourceId;

  const totalUsers = useMemo(() => {
    const analysis = snapshot
      ? getSafeRolloutSnapshotAnalysis(snapshot)
      : undefined;
    if (!analysis?.results?.[0]) return undefined;
    const vars = analysis.results[0].variations;
    return vars.reduce((sum, v) => sum + v.users, 0);
  }, [snapshot]);

  const handleToggleAutoSnapshots = async () => {
    await apiCall(`/safe-rollout/${safeRolloutId}/auto-snapshots`, {
      method: "PUT",
      body: JSON.stringify({ enabled: !autoSnapshots }),
    });
    mutateSnapshot();
    mutateSr();
  };

  const nextUpdate = srFromApi?.nextSnapshotAttempt
    ? getValidDate(srFromApi.nextSnapshotAttempt)
    : undefined;

  const autoUpdateTooltipBody = (() => {
    if (!isMonitoringActive) return inactiveReason;
    if (!autoSnapshots) return "Auto-updates are disabled. Click to enable.";
    if (nextUpdate && nextUpdate > new Date()) {
      const mins = Math.max(
        1,
        Math.round((nextUpdate.getTime() - Date.now()) / 60_000),
      );
      return `Auto-update enabled. Next update in ~${mins}m`;
    }
    return "Auto-update enabled. Click to disable.";
  })();

  const lastUpdated = snapshot?.dateCreated
    ? getValidDate(snapshot.dateCreated)
    : undefined;

  return (
    <>
      <Flex
        align="center"
        justify="between"
        mb="2"
        style={{ fontSize: 13, minHeight: 32 }}
      >
        <Flex align="center" gap="3">
          {totalUsers !== undefined && (
            <Metadata
              label="Monitored Users"
              value={numberFmt.format(totalUsers)}
              style={{ whiteSpace: "nowrap" }}
            />
          )}
        </Flex>

        <Flex align="center" gap="3">
          {/* Auto-update status + toggle */}
          <Flex align="center" gap="1">
            <Tooltip body={autoUpdateTooltipBody}>
              {isMonitoringActive && autoSnapshots ? (
                <PiLightning
                  size={18}
                  style={{ color: "var(--violet-11)", cursor: "pointer" }}
                  onClick={
                    canRunQueries ? handleToggleAutoSnapshots : undefined
                  }
                />
              ) : (
                <PiLightningSlash
                  size={18}
                  style={{
                    color: "var(--gray-8)",
                    cursor: canRunQueries ? "pointer" : "default",
                  }}
                  onClick={
                    canRunQueries && isMonitoringActive
                      ? handleToggleAutoSnapshots
                      : undefined
                  }
                />
              )}
            </Tooltip>
            {lastUpdated && (
              <Tooltip
                body={`Last update: ${getValidDate(lastUpdated).toLocaleString()}`}
              >
                <span style={{ color: "var(--color-text-mid)" }}>
                  Updated{" "}
                  {(() => {
                    const diffMs = Date.now() - lastUpdated.getTime();
                    const mins = Math.round(diffMs / 60_000);
                    if (mins < 1) return "just now";
                    if (mins < 60) return `${mins}m ago`;
                    const hrs = Math.round(mins / 60);
                    if (hrs < 24) return `${hrs}h ago`;
                    return `${Math.round(hrs / 24)}d ago`;
                  })()}
                </span>
              </Tooltip>
            )}
            {!lastUpdated && (
              <span style={{ color: "var(--color-text-mid)" }}>
                Not updated yet
              </span>
            )}
          </Flex>

          {/* Update button — always available with permissions */}
          {canRunQueries && (
            <RunQueriesButton
              cta="Update"
              cancelEndpoint={
                latestSnap
                  ? `/safe-rollout/snapshot/${latestSnap.id}/cancel`
                  : ""
              }
              mutate={mutateSnapshot}
              model={{
                queries: latestSnap?.queries || [],
                runStarted: latestSnap?.runStarted ?? null,
              }}
              icon="refresh"
              useRadixButton
              radixVariant="outline"
              onSubmit={async () => {
                try {
                  await apiCall(`/safe-rollout/${safeRolloutId}/snapshot`, {
                    method: "POST",
                  });
                  setRefreshError("");
                } catch (e) {
                  setRefreshError(e instanceof Error ? e.message : String(e));
                }
                mutateSnapshot();
              }}
            />
          )}

          {/* Query errors — show inline warning with link to details */}
          {latestSnap &&
            (status === "failed" || status === "partially-succeeded") && (
              <Tooltip
                body={
                  status === "failed"
                    ? "Snapshot update failed. Click to view queries."
                    : "Some queries had errors. Click to view."
                }
              >
                <span
                  style={{
                    color: "var(--red-9)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                  onClick={() => setQueriesModalOpen(true)}
                >
                  {status === "failed" ? "Failed" : "Partial errors"} — view
                </span>
              </Tooltip>
            )}
        </Flex>
      </Flex>

      {refreshError && (
        <Callout status="error" mb="2">
          <strong>Error updating data: </strong> {refreshError}
        </Callout>
      )}

      {queriesModalOpen && latestSnap && (
        <AsyncQueriesModal
          queries={latestSnap.queries.map((q) => q.query)}
          savedQueries={[]}
          error={latestSnap.error ?? undefined}
          close={() => setQueriesModalOpen(false)}
        />
      )}
    </>
  );
}

// ─── Main dashboard ──────────────────────────────────────────────────────────

interface SafeRolloutRuleDashboardProps {
  rampSchedule: RampScheduleInterface;
  safeRolloutId?: string;
  mutateRule?: () => void;
}

const SafeRolloutRuleDashboard: FC<SafeRolloutRuleDashboardProps> = ({
  rampSchedule,
  safeRolloutId,
  mutateRule,
}) => {
  const router = useRouter();
  const useDummyData = router.query["dummy"] === "true";

  const { metricGroups, getExperimentMetricById } = useDefinitions();

  // Expand metric groups and dedupe: if a metric appears in both tiers,
  // promote it to guardrail and drop from signal.
  const guardrailMetricIds = useMemo(
    () =>
      expandMetricGroups(
        rampSchedule.monitoringConfig?.guardrailMetricIds ?? [],
        metricGroups,
      ),
    [rampSchedule.monitoringConfig?.guardrailMetricIds, metricGroups],
  );
  const signalMetricIds = useMemo(() => {
    const guardrailSet = new Set(guardrailMetricIds);
    return expandMetricGroups(
      rampSchedule.monitoringConfig?.signalMetricIds ?? [],
      metricGroups,
    ).filter((id) => !guardrailSet.has(id));
  }, [
    rampSchedule.monitoringConfig?.signalMetricIds,
    metricGroups,
    guardrailMetricIds,
  ]);
  const allMetricIds = useMemo(
    () => [...guardrailMetricIds, ...signalMetricIds],
    [guardrailMetricIds, signalMetricIds],
  );

  // Assign dummy scenarios: first guardrail = failing, rest = passing/nodata mix
  const dummyScenarios: DummyScenario[] = allMetricIds.map((_, i) => {
    if (i === 0) return "failing";
    if (i % 3 === 2) return "nodata";
    return "passing";
  });

  const dummyMetrics = useMemo(
    () =>
      useDummyData
        ? generateDummySnapshotMetrics(
            allMetricIds,
            dummyScenarios,
            (metricId) => !!getExperimentMetricById(metricId)?.inverse,
            getExperimentMetricById,
          )
        : undefined,
    [useDummyData, allMetricIds, dummyScenarios, getExperimentMetricById],
  );

  const dummyStartMs = useMemo(() => {
    if (!useDummyData) return undefined;
    const history = rampSchedule.eventHistory;
    if (history && history.length > 0) {
      return getValidDate(history[0].timestamp).getTime();
    }
    if (rampSchedule.startedAt) {
      return getValidDate(rampSchedule.startedAt).getTime();
    }
    return undefined;
  }, [useDummyData, rampSchedule.eventHistory, rampSchedule.startedAt]);

  const dummyTs = useMemo(
    () =>
      useDummyData
        ? generateDummyTimeSeries(
            allMetricIds,
            dummyScenarios,
            dummyMetrics,
            dummyStartMs,
          )
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [useDummyData, allMetricIds.join(","), dummyMetrics, dummyStartMs],
  );

  const dummyTrafficSnapshot = useMemo(
    () => (useDummyData ? generateDummyTrafficSnapshot() : undefined),
    [useDummyData],
  );

  // ── Real data: snapshot (prefer context from SafeRolloutSnapshotProvider) ──
  const snapshotCtx = useSafeRolloutSnapshot();
  const { data: snapshotDataDirect, mutate: mutateSnapshotDirect } = useApi<{
    snapshot: SafeRolloutSnapshotInterface;
    latest?: SafeRolloutSnapshotInterface;
  }>(`/safe-rollout/${safeRolloutId}/snapshot`, {
    shouldRun: () => !useDummyData && !!safeRolloutId && !snapshotCtx.snapshot,
  });
  const snapshotData = useMemo(
    () =>
      snapshotCtx.snapshot
        ? { snapshot: snapshotCtx.snapshot, latest: snapshotCtx.latest }
        : snapshotDataDirect,
    [snapshotCtx.snapshot, snapshotCtx.latest, snapshotDataDirect],
  );

  const snapshotAnalysis = useMemo(() => {
    if (!snapshotData?.snapshot) return null;
    const analysis = getSafeRolloutSnapshotAnalysis(snapshotData.snapshot);
    return analysis?.results?.[0] ?? null;
  }, [snapshotData]);

  const snapshotDate = snapshotData?.snapshot?.dateCreated
    ? getValidDate(snapshotData.snapshot.dateCreated)
    : new Date();
  const startDate = snapshotData?.snapshot?.runStarted
    ? getValidDate(snapshotData.snapshot.runStarted)
    : new Date();

  // ── Real data: time series ──
  const urlMetricIds = allMetricIds
    .map((id) => encodeURIComponent(id))
    .join("&metricIds[]=");

  const { data: tsData, mutate: mutateTimeSeries } = useApi<{
    status: number;
    timeSeries: MetricTimeSeries[];
  }>(`/safe-rollout/${safeRolloutId}/time-series?metricIds[]=${urlMetricIds}`, {
    shouldRun: () =>
      !useDummyData && !!safeRolloutId && allMetricIds.length > 0,
  });

  const { mutateSnapshot: mutateSnapshotCtx } = snapshotCtx;
  const mutateAll = useCallback(() => {
    mutateSnapshotCtx();
    mutateSnapshotDirect();
    mutateTimeSeries();
    mutateRule?.();
  }, [mutateSnapshotCtx, mutateSnapshotDirect, mutateTimeSeries, mutateRule]);

  // ── Merge real + dummy ──
  const snapshotMetrics = useMemo(() => {
    if (useDummyData && dummyMetrics) return dummyMetrics;
    if (!snapshotAnalysis?.variations) return {};

    const result: Record<
      string,
      { baseline: SnapshotMetric; variation: SnapshotMetric }
    > = {};
    for (const metricId of allMetricIds) {
      const baseline = snapshotAnalysis.variations[0]?.metrics?.[metricId];
      const variation = snapshotAnalysis.variations[1]?.metrics?.[metricId];
      if (baseline && variation) {
        result[metricId] = { baseline, variation };
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useDummyData, dummyMetrics, snapshotAnalysis, allMetricIds.join(",")]);

  const filteredTs = useMemo(() => {
    if (useDummyData && dummyTs) return dummyTs;
    if (!tsData) return [];
    return filterInvalidMetricTimeSeries(tsData.timeSeries);
  }, [useDummyData, dummyTs, tsData]);

  const timeSeriesMap = useMemo(() => {
    const map: Record<string, MetricTimeSeries> = {};
    for (const ts of filteredTs) {
      map[ts.metricId] = ts;
    }
    return map;
  }, [filteredTs]);

  const eventMarkers = useMemo(
    () => buildEventMarkers(rampSchedule.eventHistory ?? []),
    [rampSchedule.eventHistory],
  );

  const dateExtent = useMemo((): [Date, Date] | [undefined, undefined] => {
    const dataDates: Date[] = filteredTs.flatMap((t) =>
      t.dataPoints.map((d) => getValidDate(d.date)),
    );
    // Exclude "started" from range — only include step-level events (S1+)
    const stepEventDates = eventMarkers
      .filter((m) => m.label !== "Start")
      .map((m) => m.date);

    const dates = [...dataDates, ...stepEventDates];
    if (dates.length > 0) {
      const [lo, hi] = extent(dates) as [Date, Date];
      return [lo, hi];
    }
    const fallbackStart = rampSchedule.startedAt
      ? getValidDate(rampSchedule.startedAt)
      : new Date();
    return [fallbackStart, new Date()];
  }, [filteredTs, eventMarkers, rampSchedule.startedAt]);

  if (allMetricIds.length === 0) return null;

  return (
    <Box mt="3" mb="2">
      {!useDummyData && safeRolloutId && (
        <MonitoringControls
          rampSchedule={rampSchedule}
          safeRolloutId={safeRolloutId}
          snapshot={snapshotData?.snapshot}
          latest={snapshotData?.latest}
          mutateSnapshot={mutateAll}
        />
      )}

      {guardrailMetricIds.length > 0 && (
        <MetricSection
          title="Guardrail Metrics"
          subtitle="Automatically roll back the ramp-up if any of these metrics show a statistically significant regression"
          metricIds={guardrailMetricIds}
          resultGroup="guardrail"
          snapshotMetrics={snapshotMetrics}
          timeSeries={timeSeriesMap}
          dateExtent={dateExtent}
          reportDate={snapshotDate}
          startDate={startDate}
          eventMarkers={eventMarkers}
          guardrailMetricIds={guardrailMetricIds}
          signalMetricIds={signalMetricIds}
        />
      )}

      {signalMetricIds.length > 0 && (
        <MetricSection
          title="Signal Metrics"
          subtitle="If any of these metrics show a regression, hold at the current step until healthy or manual advancement"
          metricIds={signalMetricIds}
          resultGroup="secondary"
          snapshotMetrics={snapshotMetrics}
          timeSeries={timeSeriesMap}
          dateExtent={dateExtent}
          reportDate={snapshotDate}
          startDate={startDate}
          eventMarkers={eventMarkers}
          guardrailMetricIds={guardrailMetricIds}
          signalMetricIds={signalMetricIds}
        />
      )}

      <HealthChecks
        snapshot={useDummyData ? dummyTrafficSnapshot : snapshotData?.snapshot}
      />
    </Box>
  );
};

export default SafeRolloutRuleDashboard;
