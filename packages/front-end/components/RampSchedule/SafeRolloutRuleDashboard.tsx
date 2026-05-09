import { FC, useMemo, useState } from "react";
import { Box, Separator } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { extent } from "@visx/vendor/d3-array";
import { scaleTime } from "@visx/scale";
import { ParentSizeModern } from "@visx/responsive";
import { localPoint } from "@visx/event";
import clsx from "clsx";
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
  getMetricLink,
  isFactMetric,
} from "shared/experiments";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import { PiInfo } from "react-icons/pi";
import Link from "next/link";
import Text from "@/ui/Text";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { ExperimentTableRow, getRowResults } from "@/services/experiments";
import { formatPercent } from "@/services/metrics";
import SafeRolloutTimeSeriesGraph, {
  TimeSeriesEventMarker,
} from "@/components/Experiment/SafeRolloutTimeSeriesGraph";
import AlignedGraph from "@/components/Experiment/AlignedGraph";
import PercentGraph from "@/components/Experiment/PercentGraph";
import StatusColumn from "@/components/SafeRollout/Results/StatusColumn";
import MetricName from "@/components/Metrics/MetricName";
import Tooltip from "@/components/Tooltip/Tooltip";

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

function generateDummySnapshotMetrics(
  metricIds: string[],
  scenarios: DummyScenario[],
): Record<string, { baseline: SnapshotMetric; variation: SnapshotMetric }> {
  const result: Record<
    string,
    { baseline: SnapshotMetric; variation: SnapshotMetric }
  > = {};
  metricIds.forEach((id, idx) => {
    const rand = seededRandom(hashString(id));
    const scenario = scenarios[idx % scenarios.length];
    const baseUsers = 800 + Math.floor(rand() * 4000);
    const baseCr = 0.02 + rand() * 0.15;
    const baseValue = baseUsers * baseCr;

    const baseline: SnapshotMetric = {
      value: baseValue,
      cr: baseCr,
      users: baseUsers,
      ci: [-0.05, 0.05],
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

    const variation: SnapshotMetric = {
      value: varValue,
      cr: varCr,
      users: varUsers,
      ci: [effect - ciHalf, effect + ciHalf],
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
    const baseCr = 0.02 + rand() * 0.15;

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

// ─── Metric section (table-based, matching experiment results UI) ─────────────

const SAFE_ROLLOUT_STATUS_LABELS = {
  won: "Within bounds",
  lost: "Failing",
  draw: "Within bounds",
  insignificant: "Within bounds",
  notEnoughData: "Not enough data",
  badgeColor: "var(--blue-a7)",
};

const GRAPH_WIDTH = 250;

function MetricSection({
  title,
  subtitle,
  metricIds,
  snapshotMetrics,
  timeSeries,
  dateExtent,
  reportDate,
  startDate,
  eventMarkers,
}: {
  title: string;
  subtitle: string;
  metricIds: string[];
  snapshotMetrics: Record<
    string,
    { baseline: SnapshotMetric; variation: SnapshotMetric }
  >;
  timeSeries: Record<string, MetricTimeSeries>;
  dateExtent: [Date, Date] | [undefined, undefined];
  reportDate: Date;
  startDate: Date;
  eventMarkers?: TimeSeriesEventMarker[];
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
          resultGroup: "guardrail",
        };
      })
      .filter(Boolean) as ExperimentTableRow[];
  }, [metricIds, snapshotMetrics, getExperimentMetricById]);

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

  const domain = useMemo((): [number, number] => {
    let lo = 0;
    let hi = 0;
    for (const row of rows) {
      const stats = row.variations[1];
      if (!stats?.ci) continue;
      const [ciLo, ciHi] = stats.ciAdjusted ?? stats.ci;
      if (ciLo < lo) lo = ciLo;
      if (ciHi > hi) hi = ciHi;
    }
    const pad = Math.max(Math.abs(lo), Math.abs(hi)) * 0.1 || 0.05;
    return [lo - pad, hi + pad];
  }, [rows]);

  if (rows.length === 0) return null;

  const sigThresholds = {
    pValueThreshold: 0.05,
    bayesianConfidenceLevels: {
      ciUpper: 0.975,
      ciLower: 0.025,
      ciUpperDisplay: "97.5%",
      ciLowerDisplay: "2.5%",
    },
  };

  return (
    <Box>
      <Text as="div" weight="medium" size="medium" mb="1">
        {title}
      </Text>
      <Text as="div" size="small" color="text-low" mb="3">
        {subtitle}
      </Text>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 950 }}>
          <table className="experiment-results table-sm">
            <thead>
              <tr className="results-top-row">
                <th
                  className="axis-col noStickyHeader label"
                  style={{ width: 200, whiteSpace: "nowrap" }}
                >
                  Metric
                </th>
                <th
                  className="axis-col noStickyHeader label"
                  style={{ width: 90, whiteSpace: "nowrap" }}
                >
                  % Change
                </th>
                <th className="axis-col noStickyHeader label">
                  Metric Boundary
                </th>
                <th
                  className="axis-col noStickyHeader graph-cell"
                  style={{ width: GRAPH_WIDTH }}
                >
                  <div className="position-relative">
                    <AlignedGraph
                      id="ramp-ci-axis"
                      domain={domain}
                      significant={true}
                      showAxis={true}
                      axisOnly={true}
                      graphWidth={GRAPH_WIDTH}
                      percent
                      height={45}
                    />
                  </div>
                </th>
                <th
                  className="axis-col noStickyHeader label"
                  style={{ width: 160, whiteSpace: "nowrap" }}
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
              const expected = stats?.expected ?? 0;
              const resultsHighlightClassname = clsx(rr.resultsStatus, {
                "non-significant": !rr.significant,
              });

              const ROW_HEIGHT = 55;

              return (
                <tbody className="results-group-row" key={row.metric.id}>
                  <tr
                    className="results-variation-row"
                    style={{
                      height: ROW_HEIGHT,
                      boxShadow: "var(--slate-a5) 0 -1px inset",
                    }}
                  >
                    {/* Metric label */}
                    <td
                      className="variation with-variation-label"
                      style={{ width: 200 }}
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

                    {/* % Change */}
                    <td
                      className={clsx(
                        "variation change results-change",
                        resultsHighlightClassname,
                      )}
                    >
                      <div
                        className="d-flex align-items-center justify-content-end"
                        style={{
                          minHeight: ROW_HEIGHT,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {rr.enoughData && expected !== 0 ? (
                          <span className="nowrap">
                            <span className="expectedArrows">
                              {rr.directionalStatus === "winning" ? (
                                <FaArrowUp />
                              ) : (
                                <FaArrowDown />
                              )}
                            </span>{" "}
                            <span className="expected">
                              {formatPercent(expected, {
                                maximumFractionDigits: 1,
                              })}
                            </span>
                          </span>
                        ) : (
                          <span className="result-number text-muted">—</span>
                        )}
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

                    {/* CI Graph pill */}
                    <td className="graph-cell">
                      <div
                        className="d-flex align-items-center"
                        style={{ minHeight: ROW_HEIGHT }}
                      >
                        <PercentGraph
                          significanceThresholds={sigThresholds}
                          barType="pill"
                          barFillType={
                            rr.resultsStatus === "lost"
                              ? "significant"
                              : "color"
                          }
                          barFillColor={
                            rr.resultsStatus === "lost"
                              ? undefined
                              : "var(--blue-a7)"
                          }
                          significant={rr.significant}
                          baseline={baseline}
                          domain={domain}
                          metric={row.metric}
                          stats={stats}
                          id={`ramp-ci-${row.metric.id}`}
                          graphWidth={GRAPH_WIDTH}
                          height={ROW_HEIGHT}
                          percent
                          differenceType="relative"
                          className={clsx(
                            resultsHighlightClassname,
                            "overflow-hidden",
                          )}
                          rowStatus={
                            rr.resultsStatus === "lost" ||
                            rr.resultsStatus === "won"
                              ? rr.resultsStatus
                              : undefined
                          }
                          resultsStatus={rr.resultsStatus}
                          statsEngine="frequentist"
                          notEnoughData={!rr.enoughData}
                          minSampleSize={getMinSampleSizeForMetric(row.metric)}
                          statusLabels={SAFE_ROLLOUT_STATUS_LABELS}
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
                  <td colSpan={2} />
                  <td style={{ padding: 0 }}>
                    <div style={{ height: 20, position: "relative" }}>
                      <EventMarkerLabels
                        markers={eventMarkers}
                        dateExtent={dateExtent}
                      />
                    </div>
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </Box>
  );
}

// ─── Main dashboard ──────────────────────────────────────────────────────────

interface SafeRolloutRuleDashboardProps {
  rampSchedule: RampScheduleInterface;
  safeRolloutId?: string;
}

const SafeRolloutRuleDashboard: FC<SafeRolloutRuleDashboardProps> = ({
  rampSchedule,
  safeRolloutId,
}) => {
  const router = useRouter();
  const useDummyData = router.query["dummy"] === "true";

  const { metricGroups } = useDefinitions();

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
        ? generateDummySnapshotMetrics(allMetricIds, dummyScenarios)
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [useDummyData, allMetricIds.join(",")],
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

  // ── Real data: snapshot ──
  const { data: snapshotData } = useApi<{
    snapshot: SafeRolloutSnapshotInterface;
    latest?: SafeRolloutSnapshotInterface;
  }>(`/safe-rollout/${safeRolloutId}/snapshot`, {
    shouldRun: () => !useDummyData && !!safeRolloutId,
  });

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

  const { data: tsData } = useApi<{
    status: number;
    timeSeries: MetricTimeSeries[];
  }>(`/safe-rollout/${safeRolloutId}/time-series?metricIds[]=${urlMetricIds}`, {
    shouldRun: () =>
      !useDummyData && !!safeRolloutId && allMetricIds.length > 0,
  });

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
    const dates: Date[] = [
      ...filteredTs.flatMap((t) =>
        t.dataPoints.map((d) => getValidDate(d.date)),
      ),
      ...eventMarkers.map((m) => m.date),
    ];
    if (dates.length > 0) {
      const [lo, hi] = extent(dates) as [Date, Date];
      return [lo, new Date(Math.max(hi.getTime(), Date.now()))];
    }
    const fallbackStart = rampSchedule.startedAt
      ? getValidDate(rampSchedule.startedAt)
      : new Date();
    return [fallbackStart, new Date()];
  }, [filteredTs, eventMarkers, rampSchedule.startedAt]);

  if (allMetricIds.length === 0) return null;

  return (
    <Box mt="3" mb="2">
      {guardrailMetricIds.length > 0 && (
        <MetricSection
          title="Guardrail Metrics"
          subtitle="Automatically roll back the entire schedule if any of these metrics show a statistically significant regression"
          metricIds={guardrailMetricIds}
          snapshotMetrics={snapshotMetrics}
          timeSeries={timeSeriesMap}
          dateExtent={dateExtent}
          reportDate={snapshotDate}
          startDate={startDate}
          eventMarkers={eventMarkers}
        />
      )}

      {guardrailMetricIds.length > 0 && signalMetricIds.length > 0 && (
        <Separator size="4" my="4" />
      )}

      {signalMetricIds.length > 0 && (
        <MetricSection
          title="Signal Metrics"
          subtitle="If any of these metrics show a regression, hold at the current step until healthy or manual advancement"
          metricIds={signalMetricIds}
          snapshotMetrics={snapshotMetrics}
          timeSeries={timeSeriesMap}
          dateExtent={dateExtent}
          reportDate={snapshotDate}
          startDate={startDate}
          eventMarkers={eventMarkers}
        />
      )}
    </Box>
  );
};

export default SafeRolloutRuleDashboard;
