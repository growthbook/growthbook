import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { DailyUsage } from "back-end/types/organization";
import { FaAngleLeft, FaAngleRight } from "react-icons/fa";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { AreaClosed } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { curveLinear } from "@visx/curve";
import useApi from "@/hooks/useApi";
import Callout from "@/components/Radix/Callout";
import Frame from "@/components/Radix/Frame";
import SelectField from "@/components/Forms/SelectField";
import LoadingOverlay from "@/components/LoadingOverlay";
import { isCloud } from "@/services/env";
import Badge from "@/components/Radix/Badge";

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

  return parseFloat((bytes / Math.pow(k, i)).toFixed(0)) + " " + sizes[i];
}

export default function CloudUsage() {
  const [monthsAgo, setMonthsAgo] = useState(0);

  const gb = useGrowthBook();

  const router = useRouter();
  const useDummyData = !isCloud() && !!router.query.dummy;

  const enableUsage = useDummyData || gb.isOn("cdn-usage-data");

  const { data, error } = useApi<{ cdnUsage: DailyUsage[] }>(
    `/billing/usage?monthsAgo=${monthsAgo}`,
    {
      shouldRun: () => enableUsage && !useDummyData,
    }
  );

  if (!enableUsage) return null;

  if (error) {
    return (
      <Callout status="error">
        Failed to get usage data: {error.message}
      </Callout>
    );
  }

  const usage = data?.cdnUsage || [];

  const startDate = new Date();
  startDate.setUTCMonth(startDate.getUTCMonth() - monthsAgo);
  startDate.setUTCDate(1);
  startDate.setUTCHours(0, 0, 0, 0);

  const endDate = new Date();
  endDate.setUTCMonth(endDate.getUTCMonth() - monthsAgo + 1);
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
        requests: Math.floor(Math.random() * 10000000),
        bandwidth: Math.floor(Math.random() * 10000000000),
      });
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }

  const totalRequests = usage.reduce((sum, u) => sum + u.requests, 0);
  const totalBandwidth = usage.reduce((sum, u) => sum + u.bandwidth, 0);

  const monthOptions: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const date = new Date();
    date.setUTCMonth(date.getUTCMonth() - i);

    // Skip months before Feb 2025
    if (date < new Date("2025-02-01")) continue;

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
        <h3 className="mr-4 mb-0">CDN Usage</h3>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (monthsAgo >= maxMonthsAgo) return;
            setMonthsAgo(monthsAgo + 1);
          }}
          className={
            monthsAgo >= maxMonthsAgo ? "text-secondary cursor-default" : ""
          }
        >
          <FaAngleLeft />
        </a>
        <SelectField
          options={monthOptions}
          value={monthsAgo + ""}
          onChange={(value) => setMonthsAgo(parseInt(value))}
          sort={false}
        />
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (monthsAgo <= 0) return;
            setMonthsAgo(monthsAgo - 1);
          }}
          className={monthsAgo <= 0 ? "text-secondary cursor-default" : ""}
        >
          <FaAngleRight />
        </a>
      </Flex>
      <Flex gap="3" align="center" mb="4">
        <div>
          <strong>Total Requests: </strong>
          <span>{requestsFormatter.format(totalRequests)}</span>
        </div>
        <div>
          <strong>Total Bandwidth: </strong>
          <span>{formatBytes(totalBandwidth)}</span>
        </div>
        {useDummyData && <Badge label="Dummy Data" color="amber" />}
      </Flex>
      <p>
        <em>
          Usage data not available prior to February 2025. Graphs may be delayed
          by up to 24 hours.
        </em>
      </p>
      {totalRequests > 0 && (
        <Box mb="4">
          <h3>CDN Requests</h3>
          <DailyGraph
            data={usage.map((u) => ({ ts: new Date(u.date), v: u.requests }))}
            formatValue={(v) => requestsFormatter.format(v)}
            start={startDate}
            end={endDate}
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
          />
        </Box>
      )}
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
  formatValue,
  start,
  end,
}: {
  data: { ts: Date; v: number }[];
  width?: "auto" | string;
  height?: number;
  formatValue?: (v: number) => string;
  start: Date;
  end: Date;
}) {
  data = useCumulativeData(data);

  const margin = [15, 15, 30, 60];
  const yDomain = [0, Math.max(...data.map((d) => d.v))];

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
              <div className="bg-light border">
                <svg width={width} height={height}>
                  <Group left={margin[3]} top={margin[0]}>
                    <AreaClosed
                      data={data}
                      x={(d) => xScale(d.ts)}
                      y={(d) => yScale(d.v)}
                      yScale={yScale}
                      strokeWidth={1}
                      stroke="url(#area-gradient)"
                      fill="#a44afe"
                      curve={curveLinear}
                    />
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
        </ParentSizeModern>
      </div>
    </div>
  );
}
