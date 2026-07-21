import { useMemo, useState } from "react";
import { AlertDialog, Box, Flex } from "@radix-ui/themes";
import { scaleTime } from "@visx/scale";
import { ParentSizeModern } from "@visx/responsive";
import { localPoint } from "@visx/event";
import { MetricTimeSeries, RampEvent } from "shared/validators";
import { getValidDate } from "shared/dates";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { SafeRolloutSnapshotInterface } from "shared/types/safe-rollout";
import { getMetricLink, isFactMetric } from "shared/experiments";
import {
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  SAFE_ROLLOUT_VARIATIONS,
} from "shared/constants";
import { getSRMHealthData, getMultipleExposureHealthData } from "shared/health";
import { PiCaretDownBold, PiInfo } from "react-icons/pi";
import { ExperimentReportVariation } from "shared/types/report";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
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
// eslint-disable-next-line no-restricted-imports
import Modal from "@/components/Modal";
import MetricDrilldownOverview from "@/components/MetricDrilldown/MetricDrilldownOverview";

// ---------------------------------------------------------------------------
// Event marker helpers
// ---------------------------------------------------------------------------

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
    case "step-jumped":
      return stepLabel(e.stepIndex);
    case "rollback":
      return e.stepIndex === -1 ? "Rollback" : stepLabel(e.stepIndex);
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

const MARKER_LABEL_CLUSTER_PX = 14;

export function buildEventMarkers(events: RampEvent[]): MarkerWithPriority[] {
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

        const clusteredMarkers = markers
          .map((m) => ({ marker: m, x: xScale(m.date) }))
          .sort((a, b) => a.x - b.x)
          .reduce<
            Array<{
              x: number;
              members: TimeSeriesEventMarker[];
            }>
          >((clusters, item) => {
            const last = clusters[clusters.length - 1];
            if (!last) {
              clusters.push({ x: item.x, members: [item.marker] });
              return clusters;
            }
            if (Math.abs(item.x - last.x) <= MARKER_LABEL_CLUSTER_PX) {
              last.members.push(item.marker);
              last.x =
                (last.x * (last.members.length - 1) + item.x) /
                last.members.length;
            } else {
              clusters.push({ x: item.x, members: [item.marker] });
            }
            return clusters;
          }, [])
          .map((cluster) => {
            const mergedTooltips = cluster.members.flatMap(
              (m) => m.tooltips ?? [],
            );
            const mostRecent =
              cluster.members.reduce((latest, current) =>
                current.date > latest.date ? current : latest,
              ) ?? cluster.members[0];
            return {
              marker: {
                ...mostRecent,
                color: cluster.members.some((m) => m.color === "red")
                  ? ("red" as const)
                  : ("indigo" as const),
                label: mostRecent?.label ?? "",
                tooltips: mergedTooltips,
              } as TimeSeriesEventMarker,
              x: cluster.x,
            };
          });

        const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
          const point = localPoint(e);
          if (!point) return;
          let closest = 0;
          let closestDist = Infinity;
          for (let i = 0; i < clusteredMarkers.length; i++) {
            const d = Math.abs(clusteredMarkers[i].x - point.x);
            if (d < closestDist) {
              closestDist = d;
              closest = i;
            }
          }
          if (closestDist < 30) {
            setHovered({
              marker: clusteredMarkers[closest].marker,
              x: clusteredMarkers[closest].x,
            });
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
              {clusteredMarkers.map(({ marker: m, x }, i) => {
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
                      fontSize={11}
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

// ---------------------------------------------------------------------------
// Shared formatters
// ---------------------------------------------------------------------------

export const numberFmt = Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const pctFmt = Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function pValueFmt(p: number): string {
  if (typeof p !== "number") return "";
  return p < 0.001 ? "<0.001" : p.toFixed(3);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SafeRolloutMetricDrilldownModal
// ---------------------------------------------------------------------------

function SafeRolloutMetricDrilldownModal({
  row,
  resultGroup,
  signalMetricIds,
  timeSeries,
  reportDate,
  startDate,
  endDate,
  close,
}: {
  row: ExperimentTableRow;
  resultGroup: "guardrail" | "secondary";
  signalMetricIds: string[];
  timeSeries?: MetricTimeSeries;
  reportDate: Date;
  startDate: Date;
  endDate: Date;
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
      useRadixButton={false}
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
        endDate={endDate.toISOString()}
        experimentStatus="running"
        variations={variations}
        localBaselineRow={0}
        localVariationFilter={undefined}
        goalMetrics={[]}
        secondaryMetrics={resultGroup === "secondary" ? signalMetricIds : []}
        statsEngine="frequentist"
        localDifferenceType="relative"
        preloadedTimeSeries={timeSeries}
        valueColumnWidth={170}
        labelMaxWidth={120}
        oneSided
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// MetricSection
// ---------------------------------------------------------------------------

export function MetricSection({
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
  const drilldownEndDate = dateExtent[1] ?? reportDate;

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

              const hasData = rr.enoughData || (stats.users ?? 0) > 0;

              return (
                <tbody className="results-group-row" key={row.metric.id}>
                  <tr
                    className={`results-variation-row results-metric-row${hasData ? " results-clickable-row" : ""}`}
                    onClick={
                      hasData ? () => setDrilldownRowIndex(i) : undefined
                    }
                  >
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

                    <td style={{ padding: 0 }}>
                      <div style={{ height: ROW_HEIGHT, minWidth: 250 }}>
                        <SafeRolloutTimeSeriesGraph
                          data={metricTs ?? emptyTimeSeries(row.metric.id)}
                          xDateRange={dateExtent}
                          eventMarkers={eventMarkers}
                        />
                      </div>
                    </td>

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
          signalMetricIds={signalMetricIds}
          timeSeries={timeSeries[rows[drilldownRowIndex].metric.id]}
          reportDate={reportDate}
          startDate={startDate}
          endDate={drilldownEndDate}
          close={() => setDrilldownRowIndex(null)}
        />
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// HealthChecks
// ---------------------------------------------------------------------------

type SRMHealthStatus = "healthy" | "unhealthy" | "not-enough-traffic";

export function HealthChecks({
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
    ? "No data yet"
    : hasIssue
      ? "Issues detected"
      : "All clear";

  const variations = [
    { name: "Treatment", expected: 0.5 },
    { name: "Control", expected: 0.5 },
  ];

  return (
    <Box mt="3">
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
                    <Link
                      target="_blank"
                      rel="noreferrer"
                      href="https://docs.growthbook.io/kb/experiments/troubleshooting-experiments"
                    >
                      Read about troubleshooting in our docs
                    </Link>
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

      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setExpanded(!expanded);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span
          className="link-purple font-weight-bold"
          style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
        >
          <PiCaretDownBold
            style={{
              transform: expanded ? undefined : "rotate(-90deg)",
              transition: "transform 0.15s",
            }}
          />
          <Text size="medium" weight="medium">
            Health Checks
          </Text>
        </span>
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
              No traffic data yet. Monitoring recently started, check back soon
              for updated status.
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
              <div>
                Total Users: <strong>{numberFmt.format(totalUsers)}</strong>
              </div>

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
                      <Link className="a" onClick={() => setSrmModalOpen(true)}>
                        Learn More {">"}
                      </Link>
                    </Callout>
                  ) : (
                    <Callout status="success" size="sm">
                      No Sample Ratio Mismatch (SRM) detected.
                      {srmHealth === "healthy" && (
                        <> P-value above {srmThreshold}.</>
                      )}{" "}
                      <Link className="a" onClick={() => setSrmModalOpen(true)}>
                        Learn More {">"}
                      </Link>
                    </Callout>
                  )}
                </div>
              </div>

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
