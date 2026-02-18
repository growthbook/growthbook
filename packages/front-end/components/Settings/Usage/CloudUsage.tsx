import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { DailyUsage, UsageLimits } from "shared/types/organization";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { AreaClosed } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { useRouter } from "next/router";
import { curveLinear } from "@visx/curve";
import { PiArrowSquareOut, PiCaretLeft, PiCaretRight } from "react-icons/pi";
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

function formatBytes(bytes: number) {
  if (bytes === 0) return "0";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const adjusted = bytes / Math.pow(k, i);

  return parseFloat(adjusted.toFixed(adjusted > 10 ? 0 : 1)) + " " + sizes[i];
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
        <div className="ml-auto">
          <SelectField
            options={monthOptions}
            value={monthsAgo + ""}
            onChange={(value) => setMonthsAgo(parseInt(value))}
            sort={false}
          />
        </div>
      </Flex>
      <Flex gap="5" align="center" mb="4">
        <div>
          <strong>Total requests: </strong>
          <span>{requestsFormatter.format(totalRequests)}</span>
        </div>
        <div>
          <strong>Total bandwidth: </strong>
          <span>{formatBytes(totalBandwidth)}</span>
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
            formatValue={formatBytes}
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

function useCumulativeData(data: { ts: Date; v: number }[]) {
  let sum = 0;
  return data.map((d) => {
    sum += d.v;
    return { ts: d.ts, v: sum };
  });
}

function DailyGraph({
  data,
  width = "auto",
  height = 250,
  limitLine = null,
  formatValue,
  start,
  end,
}: {
  data: { ts: Date; v: number }[];
  width?: "auto" | string;
  height?: number;
  limitLine?: null | number;
  formatValue?: (v: number) => string;
  start: Date;
  end: Date;
}) {
  data = useCumulativeData(data);

  const margin = [15, 15, 30, 60];
  const yDomain = [0, Math.max(...data.map((d) => d.v), limitLine || 0)];

  return (
    <div>
      <div style={{ width: width }}>
        <ParentSize style={{ position: "relative" }}>
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
                }}
              >
                <svg width={width} height={height}>
                  <Group left={margin[3]} top={margin[0]}>
                    <AreaClosed
                      data={data}
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
                  </Group>
                </svg>
              </div>
            );
          }}
        </ParentSize>
      </div>
    </div>
  );
}
