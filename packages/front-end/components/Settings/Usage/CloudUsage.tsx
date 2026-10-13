import { Fragment, useState } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import {
  DailyUsage,
  DailyUsageByKey,
  UsageLimits,
} from "shared/types/organization";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { AreaStack } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { useRouter } from "next/router";
import { curveLinear } from "@visx/curve";
import { defaultStyles, TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { Parser } from "json2csv";
import {
  PiArrowSquareOut,
  PiCaretLeft,
  PiCaretRight,
  PiDownloadSimple,
} from "react-icons/pi";
import useApi from "@/hooks/useApi";
import useSDKConnections from "@/hooks/useSDKConnections";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import SelectField from "@/components/Forms/SelectField";
import LoadingOverlay from "@/components/LoadingOverlay";
import MultiSelectField from "@/ui/MultiSelectField";
import { isCloud } from "@/services/env";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";
import track from "@/services/track";

// Formatter for numbers
const requestsFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
});

// Decimal, matching how CDN plan limits are authored and enforced (5_000_000_000)
function formatBandwidth(bytes: number, decimals?: number) {
  if (bytes === 0) return "0";

  const k = 1000;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const adjusted = bytes / Math.pow(k, i);
  const digits = decimals ?? (adjusted > 10 ? 0 : 1);

  return parseFloat(adjusted.toFixed(digits)) + " " + sizes[i];
}

const TOTAL_KEY = "__total__";
// By-key rows give image traffic an empty key
const IMAGES_KEY = "__images__";
const OTHER_KEY = "__other__";
const SINGLE_SERIES_COLOR = "var(--violet-9)";
const OTHER_COLOR = "var(--slate-8)";
const seriesColors = [
  "var(--violet-9)",
  "var(--cyan-9)",
  "var(--amber-9)",
  "var(--crimson-9)",
  "var(--green-9)",
  "var(--blue-9)",
  "var(--orange-9)",
  "var(--lime-10)",
];

type Series = { key: string; label: string; color: string };
type StackedPoint = { ts: Date; v: Record<string, number> };
type KeyTotals = { key: string; requests: number; bandwidth: number };

function downloadCsv(
  rows: Record<string, string | number>[],
  filename: string,
) {
  const csv = new Parser().parse(rows);

  const url = window.URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function CloudUsage() {
  const [monthsAgo, setMonthsAgo] = useState(0);
  // Empty means all keys
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const router = useRouter();
  const useDummyData = !isCloud() && !!router.query.dummy;

  const { data, error } = useApi<{
    usage: DailyUsage[];
    limits: UsageLimits;
  }>(`/billing/usage?monthsAgo=${monthsAgo}`, {
    shouldRun: () => !useDummyData,
  });
  const { data: byKeyData, error: byKeyError } = useApi<{
    rows: DailyUsageByKey[];
  }>(`/billing/usage/by-key?monthsAgo=${monthsAgo}`, {
    shouldRun: () => !useDummyData,
  });
  const { data: sdkData } = useSDKConnections();

  if (!isCloud() && !useDummyData) {
    return (
      <Callout status="warning">
        Usage data is only available on GrowthBook Cloud.
      </Callout>
    );
  }

  if (error) {
    return (
      <Callout status="error">
        Failed to get usage data: {error.message}
      </Callout>
    );
  }

  const usage = data?.usage || [];
  const limits: UsageLimits = data?.limits || {
    cdnRequests: "unlimited",
    cdnBandwidth: "unlimited",
    managedClickhouseEvents: "unlimited",
  };

  const startDate = new Date();
  startDate.setUTCDate(1);
  startDate.setUTCHours(0, 0, 0, 0);
  startDate.setUTCMonth(startDate.getUTCMonth() - monthsAgo);

  const endDate = new Date(startDate);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  endDate.setUTCDate(0);
  endDate.setUTCHours(23, 59, 59, 999);
  const month = startDate.toISOString().substring(0, 7);

  // Use dummy data for testing
  if (useDummyData) {
    const now = new Date();

    // Generate dummy data for every day in the selected month
    const current = new Date(startDate);
    for (let i = 0; i < 32; i++) {
      // Stop when we reach the next month or the current date
      if (current > endDate || current > now) break;
      usage.push({
        date: new Date(current).toISOString(),
        requests: Math.floor(Math.random() * 1000000),
        bandwidth: Math.floor(Math.random() * 2000000000),
        managedClickhouseEvents: Math.floor(Math.random() * 1000000),
      });
      current.setUTCDate(current.getUTCDate() + 1);
    }

    limits.cdnRequests = 1_000_000;
    limits.cdnBandwidth = 5_000_000_000;
  }

  const connections = sdkData?.connections ?? [];
  const getKeyLabel = (key: string) =>
    key === IMAGES_KEY
      ? "Visual Editor images"
      : (connections.find((c) => c.key === key)?.name ?? key);

  // Undefined while loading or on error: the graphs then show totals only
  const byKeyRows = (
    useDummyData ? getDummyRows(usage, connections) : byKeyData?.rows
  )?.map((r) => (r.key ? r : { ...r, key: IMAGES_KEY }));
  const keyTotals = getKeyTotals(byKeyRows ?? []);
  const isVisible = (key: string) =>
    !selectedKeys.length || selectedKeys.includes(key);
  const visibleTotals = keyTotals.filter((t) => isVisible(t.key));
  const visibleRows = byKeyRows?.filter((r) => isVisible(r.key));
  const series = byKeyRows
    ? getSeries(visibleTotals, keyTotals, getKeyLabel)
    : [{ key: TOTAL_KEY, label: "Total", color: SINGLE_SERIES_COLOR }];
  // Only keys with traffic this month, plus selections carried over from another month
  const keyOptions = [
    ...keyTotals.map((t) => t.key),
    ...selectedKeys.filter((k) => !keyTotals.some((t) => t.key === k)),
  ].map((k) => ({ value: k, label: getKeyLabel(k) }));

  const totalRequests = usage.reduce((sum, u) => sum + u.requests, 0);
  const totalBandwidth = usage.reduce((sum, u) => sum + u.bandwidth, 0);
  const totalManagedClickhouseEvents = usage.reduce(
    (sum, u) => sum + u.managedClickhouseEvents,
    0,
  );

  const monthOptions: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - i);

    // Skip months before Feb 2025
    if (date.toISOString() < "2025-02-01") continue;

    const month = date.toLocaleString("default", {
      month: "short",
      timeZone: "UTC",
    });
    const year = date.getUTCFullYear();
    monthOptions.push({
      value: i + "",
      label: `${month} ${year}`,
    });
  }
  const maxMonthsAgo = monthOptions.length - 1;

  return (
    <Frame style={{ position: "relative" }}>
      {!usage.length && <LoadingOverlay />}
      <Flex gap="2" align="center" mb="4">
        <h2 className="mr-4 mb-0">CDN Usage</h2>
        <Flex ml="auto" gap="3" align="center">
          <DropdownMenu
            disabled={!usage.length}
            menuPlacement="end"
            trigger={
              <Button
                variant="ghost"
                icon={<PiDownloadSimple />}
                disabled={!usage.length}
              >
                Export CSV
              </Button>
            }
          >
            <DropdownMenuItem
              onClick={() => {
                downloadCsv(
                  usage.map((u) => ({
                    // Trimmed, not re-parsed: the API sends "YYYY-MM-DD HH:mm:ss", which Date reads as local time
                    date: u.date.substring(0, 10),
                    requests: u.requests,
                    // Raw bytes: full precision, unlike the page's rounded display
                    bandwidth_bytes: u.bandwidth,
                    managed_clickhouse_events: u.managedClickhouseEvents,
                  })),
                  `cdn-usage-${month}.csv`,
                );
                track("Exported CDN Usage CSV", { breakdown: "totals" });
              }}
            >
              Daily totals
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!visibleRows?.length}
              onClick={() => {
                if (!visibleRows) return;
                // Respects the sources filter, like the graphs
                downloadCsv(
                  visibleRows.map((r) => ({
                    date: r.date.substring(0, 10),
                    source: getKeyLabel(r.key),
                    sdk_key: r.key === IMAGES_KEY ? "" : r.key,
                    environment:
                      connections.find((c) => c.key === r.key)?.environment ??
                      "",
                    type: r.type,
                    requests: r.requests,
                    bandwidth_bytes: r.bandwidth,
                  })),
                  `cdn-usage-by-source-${month}.csv`,
                );
                track("Exported CDN Usage CSV", { breakdown: "source" });
              }}
            >
              Daily by source
            </DropdownMenuItem>
          </DropdownMenu>
          <SelectField
            size="legacy"
            options={monthOptions}
            value={monthsAgo + ""}
            onChange={(value) => setMonthsAgo(parseInt(value))}
            sort={false}
          />
        </Flex>
      </Flex>
      <Flex gap="5" align="center" mb="4">
        <div>
          <strong>Total requests: </strong>
          <span>{requestsFormatter.format(totalRequests)}</span>
        </div>
        <div>
          <strong>Total bandwidth: </strong>
          <span>{formatBandwidth(totalBandwidth)}</span>
        </div>
        <div>
          <strong>Total managed Clickhouse events: </strong>
          <span>{requestsFormatter.format(totalManagedClickhouseEvents)}</span>
        </div>
        {useDummyData && <Badge label="Dummy Data" color="amber" />}
        <Flex className="ml-auto" gap="2">
          <Button
            variant="ghost"
            onClick={() => {
              if (monthsAgo >= maxMonthsAgo) return;
              setMonthsAgo(monthsAgo + 1);
            }}
            disabled={monthsAgo >= maxMonthsAgo}
          >
            <PiCaretLeft /> prev
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (monthsAgo <= 0) return;
              setMonthsAgo(monthsAgo - 1);
            }}
            disabled={monthsAgo <= 0}
          >
            next <PiCaretRight />
          </Button>
        </Flex>
      </Flex>
      <Callout status="info" mb="5">
        Usage data not available prior to February 2025. Graphs may be delayed
        by up to 24 hours.
      </Callout>
      {byKeyError ? (
        <Callout status="error" mb="5">
          Failed to get usage by source: {byKeyError.message}
        </Callout>
      ) : (
        keyTotals.length > 0 && (
          <Box mb="5" style={{ maxWidth: 600 }}>
            <MultiSelectField
              label="Sources"
              placeholder="All sources"
              value={selectedKeys}
              onChange={setSelectedKeys}
              options={keyOptions}
              sort={false}
            />
          </Box>
        )
      )}
      {totalRequests > 0 && (
        <Box mb="5">
          <h3>CDN Requests</h3>
          <DailyGraph
            data={getStackedData(usage, visibleRows, series, "requests")}
            series={series}
            formatValue={(v) => requestsFormatter.format(v)}
            formatTooltipValue={(v) => v.toLocaleString()}
            start={startDate}
            end={endDate}
            limitLine={
              limits.cdnRequests === "unlimited" || selectedKeys.length
                ? null
                : limits.cdnRequests
            }
          />
        </Box>
      )}
      {totalBandwidth > 0 && (
        <Box>
          <h3>CDN Bandwidth</h3>
          <DailyGraph
            data={getStackedData(usage, visibleRows, series, "bandwidth")}
            series={series}
            // Wrapped, not by reference: visx calls tickFormat as (value, index)
            formatValue={(v) => formatBandwidth(v)}
            formatTooltipValue={(v) => formatBandwidth(v, 2)}
            start={startDate}
            end={endDate}
            limitLine={
              limits.cdnBandwidth === "unlimited" || selectedKeys.length
                ? null
                : limits.cdnBandwidth
            }
          />
        </Box>
      )}
      {visibleTotals.length > 0 && (
        <UsageByKeyTable
          totals={visibleTotals}
          series={series}
          connections={connections}
          getKeyLabel={getKeyLabel}
          totalBandwidth={keyTotals.reduce((sum, t) => sum + t.bandwidth, 0)}
        />
      )}
      {totalManagedClickhouseEvents > 0 && (
        <Box mt="5">
          <h3>Managed Clickhouse Events</h3>
          <DailyGraph
            data={usage.map((u) => ({
              ts: new Date(u.date),
              v: { [TOTAL_KEY]: u.managedClickhouseEvents },
            }))}
            series={[
              { key: TOTAL_KEY, label: "Total", color: SINGLE_SERIES_COLOR },
            ]}
            formatValue={(v) => requestsFormatter.format(v)}
            formatTooltipValue={(v) => v.toLocaleString()}
            start={startDate}
            end={endDate}
            limitLine={
              limits.managedClickhouseEvents === "unlimited"
                ? null
                : limits.managedClickhouseEvents
            }
          />
        </Box>
      )}
      <Box mt="5">
        <a
          href="https://docs.growthbook.io/faq#what-are-the-growthbook-cloud-cdn-usage-limits"
          className="text-decoration-none"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            track("Clicked Read About CDN Limits Link");
          }}
        >
          <strong className="a link-purple">
            Read about CDN limits and techniques to reduce usage{" "}
            <PiArrowSquareOut style={{ position: "relative", top: "-2px" }} />
          </strong>
        </a>
      </Box>
    </Frame>
  );
}

type CumulativePoint = {
  ts: Date;
  v: Record<string, number>;
  daily: Record<string, number>;
  total: number;
  dailyTotal: number;
};

function useCumulativeData(data: StackedPoint[]): CumulativePoint[] {
  const sums: Record<string, number> = {};
  let total = 0;
  return data.map((d) => {
    let dailyTotal = 0;
    Object.entries(d.v).forEach(([k, v]) => {
      sums[k] = (sums[k] ?? 0) + v;
      dailyTotal += v;
    });
    total += dailyTotal;
    return { ts: d.ts, v: { ...sums }, daily: d.v, total, dailyTotal };
  });
}

function DailyGraph({
  data,
  series,
  width = "auto",
  height = 250,
  limitLine = null,
  formatValue,
  formatTooltipValue,
  start,
  end,
}: {
  data: StackedPoint[];
  // Bottom of the stack first
  series: Series[];
  width?: "auto" | string;
  height?: number;
  limitLine?: null | number;
  formatValue?: (v: number) => string;
  // Axis ticks are compact ("9.3M"); a tooltip exists to show the actual number
  formatTooltipValue?: (v: number) => string;
  start: Date;
  end: Date;
}) {
  const points = useCumulativeData(data);
  const formatTooltip =
    formatTooltipValue ?? formatValue ?? ((v: number) => v.toLocaleString());

  const {
    tooltipOpen,
    tooltipLeft,
    tooltipTop,
    tooltipData,
    showTooltip,
    hideTooltip,
  } = useTooltip<CumulativePoint>();

  const margin = [15, 15, 30, 60];
  const yDomain = [0, Math.max(...points.map((d) => d.total), limitLine || 0)];

  return (
    <div>
      <div style={{ width: width }}>
        <ParentSizeModern style={{ position: "relative" }}>
          {({ width }) => {
            const yMax = height - margin[0] - margin[2];
            const xMax = width - margin[1] - margin[3];
            const graphHeight = yMax;

            const xScale = scaleTime({
              range: [0, xMax],
              domain: [start, end],
            });
            const yScale = scaleLinear<number>({
              domain: yDomain,
              range: [graphHeight, 0],
              round: true,
            });

            return (
              <div
                className="rounded"
                style={{
                  border: "1px solid var(--slate-a5)",
                  position: "relative",
                }}
              >
                <svg width={width} height={height}>
                  <Group left={margin[3]} top={margin[0]}>
                    <AreaStack<CumulativePoint, string>
                      keys={series.map((s) => s.key)}
                      data={points}
                      value={(d, key) => d.v[key] ?? 0}
                      x={(d) => xScale(d.data.ts)}
                      y0={(d) => yScale(d[0])}
                      y1={(d) => yScale(d[1])}
                      curve={curveLinear}
                    >
                      {({ stacks, path }) =>
                        stacks.map((stack, i) => (
                          <path
                            key={stack.key}
                            d={path(stack) || ""}
                            fill={series[i].color}
                          />
                        ))
                      }
                    </AreaStack>
                    {limitLine && (
                      <line
                        x1={0}
                        x2={xMax}
                        y1={yScale(limitLine)}
                        y2={yScale(limitLine)}
                        stroke="var(--red-9)"
                        strokeWidth={2}
                        strokeDasharray="4"
                      />
                    )}
                    <AxisLeft
                      scale={yScale}
                      stroke="var(--slate-a4)"
                      tickStroke="var(--slate-a4)"
                      tickFormat={formatValue}
                      tickLabelProps={() => ({
                        fill: "var(--text-color-table)",
                        fontSize: 11,
                        textAnchor: "end",
                        dy: 3,
                        dx: -5,
                      })}
                    />
                    <AxisBottom
                      top={yMax}
                      left={0}
                      scale={xScale}
                      tickFormat={(d) => {
                        return (d as Date).toLocaleString("default", {
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        });
                      }}
                      stroke="var(--slate-a4)"
                      tickStroke="var(--slate-a4)"
                      tickLabelProps={() => ({
                        fill: "var(--text-color-table)",
                        fontSize: 11,
                        textAnchor: "middle",
                      })}
                    />
                    {tooltipOpen && tooltipData && (
                      <g style={{ pointerEvents: "none" }}>
                        <line
                          x1={xScale(tooltipData.ts)}
                          x2={xScale(tooltipData.ts)}
                          y1={0}
                          y2={graphHeight}
                          stroke="var(--slate-a8)"
                          strokeWidth={1}
                        />
                        <circle
                          cx={xScale(tooltipData.ts)}
                          cy={yScale(tooltipData.total)}
                          r={4}
                          fill="var(--slate-12)"
                          stroke="var(--slate-1)"
                          strokeWidth={2}
                        />
                      </g>
                    )}
                    <rect
                      x={0}
                      y={0}
                      width={Math.max(xMax, 0)}
                      height={graphHeight}
                      fill="transparent"
                      onMouseLeave={() => hideTooltip()}
                      onMouseMove={(event) => {
                        const point = localPoint(event);
                        if (!point || !points.length) return;
                        const target = xScale
                          .invert(point.x - margin[3])
                          .getTime();
                        const closest = points.reduce((best, p) =>
                          Math.abs(p.ts.getTime() - target) <
                          Math.abs(best.ts.getTime() - target)
                            ? p
                            : best,
                        );
                        showTooltip({
                          tooltipData: closest,
                          tooltipLeft: xScale(closest.ts) + margin[3],
                          tooltipTop: yScale(closest.total) + margin[0],
                        });
                      }}
                    />
                  </Group>
                </svg>
                {tooltipOpen && tooltipData && (
                  <TooltipWithBounds
                    top={tooltipTop}
                    left={tooltipLeft}
                    style={{
                      ...defaultStyles,
                      backgroundColor: "var(--slate-2)",
                      color: "var(--slate-12)",
                      boxShadow: "var(--shadow-4)",
                      borderRadius: 4,
                      padding: 10,
                      pointerEvents: "none",
                      zIndex: 1000,
                    }}
                  >
                    <Text as="div" color="text-low" mb="2">
                      {tooltipData.ts.toLocaleDateString("default", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </Text>
                    <Grid
                      columns="auto auto auto"
                      gapX="4"
                      gapY="1"
                      align="center"
                    >
                      <span />
                      <Text color="text-low" align="right">
                        This day
                      </Text>
                      <Text color="text-low" align="right">
                        Month to date
                      </Text>
                      {series.length > 1 &&
                        [...series].reverse().map((s) => (
                          <Fragment key={s.key}>
                            <Flex align="center" gap="2">
                              <SeriesSwatch color={s.color} />
                              {s.label}
                            </Flex>
                            <Text align="right">
                              {formatTooltip(tooltipData.daily[s.key] ?? 0)}
                            </Text>
                            <Text align="right">
                              {formatTooltip(tooltipData.v[s.key] ?? 0)}
                            </Text>
                          </Fragment>
                        ))}
                      <strong>Total</strong>
                      <Text align="right" weight="semibold">
                        {formatTooltip(tooltipData.dailyTotal)}
                      </Text>
                      <Text align="right" weight="semibold">
                        {formatTooltip(tooltipData.total)}
                      </Text>
                    </Grid>
                  </TooltipWithBounds>
                )}
              </div>
            );
          }}
        </ParentSizeModern>
      </div>
    </div>
  );
}

function SeriesSwatch({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: 2,
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

function UsageByKeyTable({
  totals,
  series,
  connections,
  getKeyLabel,
  totalBandwidth,
}: {
  totals: KeyTotals[];
  series: Series[];
  connections: SDKConnectionInterface[];
  getKeyLabel: (key: string) => string;
  // Across all keys, so a share doesn't change with the filter
  totalBandwidth: number;
}) {
  return (
    <Box mt="5">
      <h3>Usage by Source</h3>
      <Table variant="list" stickyHeader={false} roundedCorners>
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Source</TableColumnHeader>
            <TableColumnHeader>Environment</TableColumnHeader>
            <TableColumnHeader justify="end">Requests</TableColumnHeader>
            <TableColumnHeader justify="end">Bandwidth</TableColumnHeader>
            <TableColumnHeader justify="end">
              Share of bandwidth
            </TableColumnHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {totals.map((t) => {
            const connection = connections.find((c) => c.key === t.key);
            const color =
              series.find((s) => s.key === t.key)?.color ?? OTHER_COLOR;
            return (
              <TableRow key={t.key}>
                <TableCell>
                  <Flex align="center" gap="2">
                    <SeriesSwatch color={color} />
                    {connection ? (
                      <Link href={`/sdks/${connection.id}`}>
                        {connection.name}
                      </Link>
                    ) : t.key === IMAGES_KEY ? (
                      getKeyLabel(t.key)
                    ) : (
                      <span>
                        <code>{t.key}</code>{" "}
                        <Text color="text-low">(deleted or unknown)</Text>
                      </span>
                    )}
                  </Flex>
                </TableCell>
                <TableCell>{connection?.environment ?? ""}</TableCell>
                <TableCell justify="end">
                  {requestsFormatter.format(t.requests)}
                </TableCell>
                <TableCell justify="end">
                  {formatBandwidth(t.bandwidth)}
                </TableCell>
                <TableCell justify="end">
                  {totalBandwidth
                    ? `${((t.bandwidth / totalBandwidth) * 100).toFixed(1)}%`
                    : "-"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

function getKeyTotals(rows: DailyUsageByKey[]): KeyTotals[] {
  const byKey = new Map<string, KeyTotals>();
  rows.forEach((r) => {
    const t = byKey.get(r.key) ?? { key: r.key, requests: 0, bandwidth: 0 };
    t.requests += r.requests;
    t.bandwidth += r.bandwidth;
    byKey.set(r.key, t);
  });
  return [...byKey.values()].sort((a, b) => b.bandwidth - a.bandwidth);
}

// Past the palette, the smallest keys share one "Other" series
function getShownTotals(totals: KeyTotals[]): KeyTotals[] {
  return totals.length > seriesColors.length
    ? totals.slice(0, seriesColors.length - 1)
    : totals;
}

// Colors follow the unfiltered ranking, so filtering doesn't recolor a key
function getSeries(
  totals: KeyTotals[],
  allTotals: KeyTotals[],
  getKeyLabel: (key: string) => string,
): Series[] {
  const rankColors = new Map(
    getShownTotals(allTotals).map((t, i) => [t.key, seriesColors[i]]),
  );
  const shown = getShownTotals(totals);
  const freeColors = seriesColors.filter(
    (c) => !shown.some((t) => rankColors.get(t.key) === c),
  );
  const series = shown.map((t) => ({
    key: t.key,
    label: getKeyLabel(t.key),
    color: rankColors.get(t.key) ?? freeColors.shift() ?? OTHER_COLOR,
  }));
  if (shown.length < totals.length) {
    series.push({
      key: OTHER_KEY,
      label: `Other (${totals.length - shown.length})`,
      color: OTHER_COLOR,
    });
  }
  return series;
}

function getStackedData(
  usage: DailyUsage[],
  // Already filtered to the visible keys; undefined falls back to totals
  rows: DailyUsageByKey[] | undefined,
  series: Series[],
  metric: "requests" | "bandwidth",
): StackedPoint[] {
  if (!rows) {
    return usage.map((u) => ({
      ts: new Date(u.date),
      v: { [TOTAL_KEY]: u[metric] },
    }));
  }
  const seriesKeys = new Set(series.map((s) => s.key));
  const byDay = new Map<string, Record<string, number>>();
  rows.forEach((r) => {
    const day = r.date.substring(0, 10);
    const v = byDay.get(day) ?? {};
    const key = seriesKeys.has(r.key) ? r.key : OTHER_KEY;
    v[key] = (v[key] ?? 0) + r[metric];
    byDay.set(day, v);
  });
  // By-key rows skip days without traffic, so the daily totals set the days
  return usage.map((u) => ({
    ts: new Date(u.date),
    v: byDay.get(u.date.substring(0, 10)) ?? {},
  }));
}

// Splits each dummy day's totals across keys, so the stacks add up to the totals
function getDummyRows(
  usage: DailyUsage[],
  connections: SDKConnectionInterface[],
): DailyUsageByKey[] {
  const keys = [
    ...connections.slice(0, 6).map((c) => c.key),
    ...[1, 2, 3, 4].map((i) => `sdk-deletedConnection${i}`),
    "",
  ];
  const weights = keys.map((_, i) => 1 / (i + 1));
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  return usage.flatMap((u) =>
    keys.map((key, i) => ({
      date: u.date,
      key,
      type: key ? "json" : "image",
      requests: Math.round((u.requests * weights[i]) / weightSum),
      bandwidth: Math.round((u.bandwidth * weights[i]) / weightSum),
    })),
  );
}
