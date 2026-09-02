import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { DailyUsage, UsageLimits } from "shared/types/organization";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { AreaClosed } from "@visx/shape";
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
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import SelectField from "@/components/Forms/SelectField";
import LoadingOverlay from "@/components/LoadingOverlay";
import { isCloud } from "@/services/env";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import track from "@/services/track";

// Formatter for numbers
const requestsFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
});

// Decimal, matching how CDN plan limits are authored and enforced (5_000_000_000)
function formatBandwidth(bytes: number) {
  if (bytes === 0) return "0";

  const k = 1000;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const adjusted = bytes / Math.pow(k, i);

  return parseFloat(adjusted.toFixed(adjusted > 10 ? 0 : 1)) + " " + sizes[i];
}

function downloadUsageCsv(usage: DailyUsage[], month: string) {
  const csv = new Parser().parse(
    usage.map((u) => ({
      // Trimmed, not re-parsed: the API sends "YYYY-MM-DD HH:mm:ss", which Date reads as local time
      date: u.date.substring(0, 10),
      requests: u.requests,
      // Raw bytes: full precision, unlike the page's rounded display
      bandwidth_bytes: u.bandwidth,
      managed_clickhouse_events: u.managedClickhouseEvents,
    })),
  );

  const url = window.URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `cdn-usage-${month}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function CloudUsage() {
  const [monthsAgo, setMonthsAgo] = useState(0);

  const router = useRouter();
  const useDummyData = !isCloud() && !!router.query.dummy;

  const { data, error } = useApi<{
    usage: DailyUsage[];
    limits: UsageLimits;
  }>(`/billing/usage?monthsAgo=${monthsAgo}`, {
    shouldRun: () => !useDummyData,
  });

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
        <Flex className="ml-auto" gap="3" align="center">
          <Button
            variant="ghost"
            disabled={!usage.length}
            onClick={() => {
              downloadUsageCsv(usage, startDate.toISOString().substring(0, 7));
              track("Exported CDN Usage CSV");
            }}
          >
            <PiDownloadSimple /> Export CSV
          </Button>
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
      {totalRequests > 0 && (
        <Box mb="5">
          <h3>CDN Requests</h3>
          <DailyGraph
            data={usage.map((u) => ({ ts: new Date(u.date), v: u.requests }))}
            formatValue={(v) => requestsFormatter.format(v)}
            formatTooltipValue={(v) => v.toLocaleString()}
            start={startDate}
            end={endDate}
            limitLine={
              limits.cdnRequests === "unlimited" ? null : limits.cdnRequests
            }
          />
        </Box>
      )}
      {totalBandwidth > 0 && (
        <Box>
          <h3>CDN Bandwidth</h3>
          <DailyGraph
            data={usage.map((u) => ({
              ts: new Date(u.date),
              v: u.bandwidth,
            }))}
            formatValue={formatBandwidth}
            start={startDate}
            end={endDate}
            limitLine={
              limits.cdnBandwidth === "unlimited" ? null : limits.cdnBandwidth
            }
          />
        </Box>
      )}
      {totalManagedClickhouseEvents > 0 && (
        <Box>
          <h3>Managed Clickhouse Events</h3>
          <DailyGraph
            data={usage.map((u) => ({
              ts: new Date(u.date),
              v: u.managedClickhouseEvents,
            }))}
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

type CumulativePoint = { ts: Date; v: number; daily: number };

function useCumulativeData(data: { ts: Date; v: number }[]): CumulativePoint[] {
  let sum = 0;
  return data.map((d) => {
    sum += d.v;
    return { ts: d.ts, v: sum, daily: d.v };
  });
}

function DailyGraph({
  data,
  width = "auto",
  height = 250,
  limitLine = null,
  formatValue,
  formatTooltipValue,
  start,
  end,
}: {
  data: { ts: Date; v: number }[];
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
  const yDomain = [0, Math.max(...points.map((d) => d.v), limitLine || 0)];

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
                    <AreaClosed
                      data={points}
                      x={(d) => xScale(d.ts)}
                      y={(d) => yScale(d.v)}
                      yScale={yScale}
                      strokeWidth={1}
                      stroke="url(#area-gradient)"
                      fill="var(--violet-9)"
                      curve={curveLinear}
                    />
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
                          cy={yScale(tooltipData.v)}
                          r={4}
                          fill="var(--violet-9)"
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
                          tooltipTop: yScale(closest.v) + margin[0],
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
                    <Box className="text-muted" mb="2">
                      {tooltipData.ts.toLocaleDateString("default", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </Box>
                    <Flex justify="between" gap="4">
                      <span>This day</span>
                      <strong>{formatTooltip(tooltipData.daily)}</strong>
                    </Flex>
                    <Flex justify="between" gap="4">
                      <span>Month to date</span>
                      <strong>{formatTooltip(tooltipData.v)}</strong>
                    </Flex>
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
