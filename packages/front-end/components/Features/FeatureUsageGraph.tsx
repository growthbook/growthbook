import { BarStack } from "@visx/shape";
import { scaleBand, scaleLinear, scaleOrdinal } from "@visx/scale";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { LegendItem, LegendLabel, LegendOrdinal } from "@visx/legend";
import { AxisBottom, AxisLeft } from "@visx/axis";
import {
  createContext,
  Fragment,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  FeatureInterface,
  FeatureUsageData,
  FeatureUsageDataPoint,
  FeatureValueType,
} from "shared/types/feature";
import { FeatureUsageLookback } from "shared/types/integrations";
import { useRouter } from "next/router";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { defaultStyles, TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { datetime } from "shared/dates";
import stringify from "json-stringify-pretty-compact";
import { FaBoltLightning } from "react-icons/fa6";
import { PiCaretRightBold } from "react-icons/pi";
import useApi from "@/hooks/useApi";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { growthbook } from "@/services/utils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Modal from "@/components/Modal";
import { Select, SelectItem } from "@/ui/Select";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import styles from "./FeatureUsageGraph.module.scss";

function generateTimeSeries(lookback: FeatureUsageLookback, keys: string[]) {
  const now = new Date();
  const start = new Date(now);
  start.setSeconds(0, 0);
  let step = 0;

  if (lookback === "15minute") {
    start.setMinutes(start.getMinutes() - 15);
    step = 60 * 1000;
  } else if (lookback === "hour") {
    start.setHours(start.getHours() - 1);
    step = 5 * 60 * 1000;
  } else if (lookback === "day") {
    start.setDate(start.getDate() - 1);
    step = 60 * 60 * 1000;
  } else if (lookback === "week") {
    start.setDate(start.getDate() - 7);
    step = 6 * 60 * 60 * 1000;
  }

  const timeSeries: FeatureUsageDataPoint[] = [];
  for (let i = 0; i < 30; i++) {
    const time = new Date(start.getTime() + i * step);
    if (time > now) break;
    timeSeries.push({
      t: time.getTime(),
      v: Object.fromEntries(
        keys.map((key) => [key, Math.floor(Math.random() * 1000)]),
      ),
    });
  }
  return timeSeries;
}

function getDummyData(
  feature: FeatureInterface,
  lookback: FeatureUsageLookback,
): FeatureUsageData {
  const ruleIds = new Set<string>();
  const sources = new Set<string>(["defaultValue"]);
  const values = new Set<string>([feature.defaultValue]);
  Object.values(feature.environmentSettings).forEach((env) => {
    env.rules.forEach((rule) => {
      if (rule.id) ruleIds.add(rule.id);
      if (rule.type === "force") {
        sources.add("force");
        values.add(rule.value);
      } else if (rule.type === "rollout") {
        sources.add("rollout");
        values.add(rule.value);
      } else if (rule.type === "experiment-ref") {
        sources.add("experiment");
        rule.variations.forEach((v) => {
          if (v.value) values.add(v.value);
        });
      }
    });
  });
  return {
    total: Math.floor(Math.random() * 500),
    bySource: generateTimeSeries(lookback, Array.from(sources)),
    byValue: generateTimeSeries(lookback, Array.from(values)),
    byRuleId: generateTimeSeries(lookback, Array.from(ruleIds)),
  };
}

const formatter = Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const SPARK_LOOKBACK: FeatureUsageLookback = "15minute";
const OTHER_KEY = "(other)";
const TOP_N = 3;

const categoricalColors = [
  "var(--blue-7)",
  "var(--green-9)",
  "var(--amber-9)",
  "var(--violet-9)",
  "var(--crimson-9)",
  "var(--cyan-9)",
  "var(--lime-10)",
  "var(--orange-9)",
];
const booleanColors = {
  true: "rgb(32, 164, 240)",
  false: "rgb(170, 170, 170)",
};

const featureUsageContext = createContext<{
  lookback: FeatureUsageLookback;
  setLookback: (lookback: FeatureUsageLookback) => void;
  featureUsage: FeatureUsageData | undefined;
  sparkFeatureUsage: FeatureUsageData | undefined;
  showFeatureUsage: boolean;
  mutateFeatureUsage: () => void;
}>({
  lookback: "15minute",
  setLookback: () => {},
  showFeatureUsage: false,
  featureUsage: undefined,
  sparkFeatureUsage: undefined,
  mutateFeatureUsage: () => {},
});

export function FeatureUsageProvider({
  feature,
  children,
}: {
  feature: FeatureInterface | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const useDummyData = router.query["dummy"] === "true";

  const [lookback, setLookback] = useLocalStorage<FeatureUsageLookback>(
    "featureUsageLookback",
    "15minute",
  );

  const { datasources } = useDefinitions();
  const hasGrowthbookClickhouseDatasource = !!datasources.find(
    (ds) => ds.type === "growthbook_clickhouse",
  );
  const showFeatureUsage =
    useDummyData ||
    (growthbook.isOn("feature-usage") && hasGrowthbookClickhouseDatasource);

  const { data, mutate: mutateFeatureUsage } = useApi<{
    usage: FeatureUsageData;
  }>(`/feature/${feature?.id}/usage?lookback=${lookback}`, {
    shouldRun: () => !!feature && showFeatureUsage && !useDummyData,
  });

  const { data: sparkData, mutate: mutateSparkData } = useApi<{
    usage: FeatureUsageData;
  }>(`/feature/${feature?.id}/usage?lookback=${SPARK_LOOKBACK}`, {
    shouldRun: () =>
      !!feature &&
      showFeatureUsage &&
      !useDummyData &&
      lookback !== SPARK_LOOKBACK,
  });

  const featureUsage =
    useDummyData && feature ? getDummyData(feature, lookback) : data?.usage;

  const sparkFeatureUsage =
    useDummyData && feature
      ? getDummyData(feature, SPARK_LOOKBACK)
      : lookback === SPARK_LOOKBACK
        ? data?.usage
        : sparkData?.usage;

  const featureUsageAutoRefreshInterval = growthbook.getFeatureValue(
    "feature-usage-auto-refresh-interval",
    { withData: 0, withoutData: 0 },
  );

  useEffect(() => {
    const hasData =
      (featureUsage?.bySource?.length ?? 0) > 0 ||
      (sparkFeatureUsage?.bySource?.length ?? 0) > 0;
    const interval = hasData
      ? featureUsageAutoRefreshInterval["withData"]
      : featureUsageAutoRefreshInterval["withoutData"];
    if (interval === 0) return;
    const timer = setInterval(() => {
      if (lookback === SPARK_LOOKBACK) {
        mutateFeatureUsage();
      } else {
        if (lookback === "15minute") mutateFeatureUsage();
        mutateSparkData();
      }
    }, interval);
    return () => clearInterval(timer);
  }, [
    lookback,
    featureUsage,
    sparkFeatureUsage,
    featureUsageAutoRefreshInterval,
    mutateFeatureUsage,
    mutateSparkData,
  ]);

  return (
    <featureUsageContext.Provider
      value={{
        lookback,
        setLookback,
        showFeatureUsage,
        featureUsage,
        sparkFeatureUsage,
        mutateFeatureUsage,
      }}
    >
      {children}
    </featureUsageContext.Provider>
  );
}

export function useFeatureUsage() {
  return useContext(featureUsageContext);
}

export function FeatureUsageContainer({
  valueType,
  revision,
  environments,
  initialTab = "value",
}: {
  valueType: FeatureValueType;
  revision?: FeatureRevisionInterface;
  environments?: string[];
  initialTab?: "source" | "value" | "rule";
}) {
  const [tab, setTab] = useState<"source" | "value" | "rule">(initialTab);
  const { featureUsage, lookback, setLookback } = useFeatureUsage();

  const ruleLabelMapping = new Map<string, string>();
  environments?.forEach((env) => {
    revision?.rules?.[env]?.forEach((rule, i) => {
      ruleLabelMapping.set(rule.id, `${env} #${i + 1}`);
    });
  });

  return (
    <Tabs
      value={tab}
      onValueChange={(tab: "source" | "value" | "rule") => setTab(tab)}
      className="mb-3"
    >
      <Flex align="center" justify="between" mb="1">
        <TabsList>
          <TabsTrigger value="value">By Value</TabsTrigger>
          <TabsTrigger value="source">By Source</TabsTrigger>
          <TabsTrigger value="rule">By Environment &amp; Rule</TabsTrigger>
        </TabsList>
        <Select
          size="2"
          value={lookback}
          setValue={(v) => setLookback(v as FeatureUsageLookback)}
          align="end"
        >
          <SelectItem value="15minute">
            <Text weight="medium" as="span">
              <Flex align="center" gap="2">
                Past 15 Minutes
                <Badge
                  label={
                    <>
                      <FaBoltLightning /> Live
                    </>
                  }
                  color="green"
                  variant="solid"
                  radius="full"
                />
              </Flex>
            </Text>
          </SelectItem>
          <SelectItem value="hour">
            <Text weight="medium" as="span">
              Past Hour
            </Text>
          </SelectItem>
          <SelectItem value="day">
            <Text weight="medium" as="span">
              Past Day
            </Text>
          </SelectItem>
          <SelectItem value="week">
            <Text weight="medium" as="span">
              Past Week
            </Text>
          </SelectItem>
        </Select>
      </Flex>
      <TabsContent value="value">
        <FeatureUsageGraph
          data={featureUsage?.byValue}
          width="100%"
          height={225}
          showLegend={true}
          showAxes={true}
          groupTopN={true}
          formatLabel={(value) => {
            if (valueType === "string") return `"${value}"`;
            if (valueType === "json") {
              try {
                return stringify(JSON.parse(value));
              } catch (e) {
                // not valid JSON
              }
            }
            return value;
          }}
          filterKeys={(key) =>
            valueType === "boolean" ? ["false", "true"].includes(key) : true
          }
        />
      </TabsContent>
      <TabsContent value="source">
        <FeatureUsageGraph
          data={featureUsage?.bySource}
          width="100%"
          height={225}
          showLegend={true}
          showAxes={true}
        />
      </TabsContent>
      <TabsContent value="rule">
        <FeatureUsageGraph
          data={featureUsage?.byRuleId}
          width="100%"
          height={225}
          showLegend={true}
          showAxes={true}
          filterKeys={(key) => ruleLabelMapping.has(key)}
          formatLabel={(ruleId) => ruleLabelMapping.get(ruleId) || ruleId}
        />
      </TabsContent>
    </Tabs>
  );
}

type TooltipData = {
  bar: { data: FeatureUsageDataPoint };
};

export default function FeatureUsageGraph({
  data,
  width = "100%",
  height = 150,
  singleKey,
  showLegend = false,
  showAxes = false,
  formatLabel,
  filterKeys,
  groupTopN = false,
}: {
  data: FeatureUsageDataPoint[] | undefined;
  width?: "auto" | string;
  height?: number;
  singleKey?: string;
  showLegend?: boolean;
  showAxes?: boolean;
  formatLabel?: (label: string) => string;
  filterKeys?: (key: string) => boolean;
  groupTopN?: boolean;
}) {
  data = data?.filter(Boolean);

  const [disabledKeys, setDisabledKeys] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [hoveredT, setHoveredT] = useState<number | null>(null);
  const tooltipTimeout = useRef<number | undefined>(undefined);

  const {
    tooltipOpen,
    tooltipLeft,
    tooltipTop,
    tooltipData,
    hideTooltip,
    showTooltip,
  } = useTooltip<TooltipData>();

  if (!data) return null;

  const margin = showAxes ? [10, 10, 28, 35] : [0, 0, 0, 0];

  const keySet = new Set<string>();
  if (singleKey) {
    keySet.add(singleKey);
  } else {
    data.forEach((d) => Object.keys(d.v).forEach((k) => keySet.add(k)));
  }
  let keys = Array.from(keySet);
  if (filterKeys) keys = keys.filter(filterKeys);

  const isBoolean = keys.every((k) => ["true", "false"].includes(k));
  const useGrouping =
    groupTopN && !isBoolean && !expanded && keys.length > TOP_N;

  const keyTotals = new Map<string, number>();
  keys.forEach((k) => keyTotals.set(k, 0));
  data.forEach((d) => {
    keys.forEach((k) =>
      keyTotals.set(k, (keyTotals.get(k) ?? 0) + (d.v[k] || 0)),
    );
  });
  const grandTotal = Array.from(keyTotals.values()).reduce((s, v) => s + v, 0);
  const keysByVolume = [...keys].sort(
    (a, b) => (keyTotals.get(b) ?? 0) - (keyTotals.get(a) ?? 0),
  );

  const topKeys = keysByVolume.slice(0, TOP_N);
  const restKeys = keysByVolume.slice(TOP_N);

  // Stable color map keyed by volume rank, so colors don't shift between grouped/expanded
  const keyColorMap = new Map<string, string>();
  if (!isBoolean) {
    let paletteIdx = 0;
    keysByVolume.forEach((k) => {
      keyColorMap.set(
        k,
        k === "defaultValue"
          ? booleanColors.false
          : categoricalColors[paletteIdx++ % categoricalColors.length],
      );
    });
    keyColorMap.set(OTHER_KEY, "var(--violet-a8)");
  }

  let rawDisplayKeys: string[];
  let displayData = data;

  if (useGrouping) {
    rawDisplayKeys = [OTHER_KEY, ...topKeys];
    displayData = data.map((d) => ({
      ...d,
      v: {
        ...Object.fromEntries(topKeys.map((k) => [k, d.v[k] ?? 0])),
        [OTHER_KEY]: restKeys.reduce((s, k) => s + (d.v[k] || 0), 0),
      },
    }));
  } else {
    rawDisplayKeys = [...keys];
  }

  // Stack order: defaultValue (base) → otherKey/restKeys → topKeys (top)
  const stackRank = (k: string) => {
    if (k === "defaultValue") return 0;
    if (k === OTHER_KEY) return 1;
    if (restKeys.includes(k)) return 2;
    return 3;
  };
  const displayKeys = [...rawDisplayKeys].sort((a, b) => {
    const dr = stackRank(a) - stackRank(b);
    if (dr !== 0) return dr;
    // lower volume sits at the bottom of each sub-group, highest volume at the top
    return (keyTotals.get(a) ?? 0) - (keyTotals.get(b) ?? 0);
  });

  const colors = isBoolean
    ? displayKeys.map((k) => booleanColors[k as "true" | "false"])
    : displayKeys.map((k) => keyColorMap.get(k) ?? categoricalColors[0]);

  const activeKeys = displayKeys.filter((k) => !disabledKeys.has(k));

  const maxValue =
    displayData.reduce((max, p) => {
      const total = activeKeys.reduce((s, k) => s + (p.v[k] || 0), 0);
      return Math.max(max, total);
    }, 0) || 0;

  const yDomain = maxValue ? [0, maxValue] : [];
  const xDomain = displayData.map((d) => d.t);

  const colorScale = scaleOrdinal({ domain: displayKeys, range: colors });

  const msRange = Math.max(...xDomain) - Math.min(...xDomain);
  function formatDate(d: number) {
    const date = new Date(d);
    if (msRange < 1000 * 60 * 60 * 24) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (msRange < 1000 * 60 * 60 * 24 * 7) {
      return date.toLocaleDateString([], { weekday: "short", hour: "numeric" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  // Shared sort for tooltip rows and legend items:
  // topKeys first (desc volume) → restKeys (desc volume) → otherKey → defaultValue
  const legendRank = (k: string) => {
    if (k === "defaultValue") return 3;
    if (k === OTHER_KEY) return 2;
    if (restKeys.includes(k)) return 1;
    return 0;
  };
  const legendSort = (a: string, b: string) => {
    const dr = legendRank(a) - legendRank(b);
    if (dr !== 0) return dr;
    return (keyTotals.get(b) ?? 0) - (keyTotals.get(a) ?? 0);
  };

  const keyLabel = (k: string) =>
    formatLabel && k !== OTHER_KEY ? formatLabel(k) : k || '""';

  const swatchStyle = (k: string) => ({
    width: 15,
    height: 15,
    background: k === OTHER_KEY ? undefined : colorScale(k),
  });

  return (
    <div style={{ marginBottom: -10, position: "relative" }}>
      <div style={{ width }}>
        <ParentSizeModern style={{ position: "relative" }}>
          {({ width }) => {
            const yMax = height - margin[0] - margin[2];
            const xMax = width - margin[1] - margin[3];

            const xScale = scaleBand({
              domain: xDomain,
              range: [0, xMax],
              round: true,
              padding: 0.2,
            });
            const yScale = scaleLinear<number>({
              domain: yDomain,
              range: [yMax, 0],
              round: true,
            });

            return (
              <div
                className="mt-2"
                style={{ width, height, position: "relative" }}
              >
                <svg width={width} height={height}>
                  <defs>
                    <pattern
                      id="other-stripe"
                      patternUnits="userSpaceOnUse"
                      width="8"
                      height="8"
                    >
                      <rect width="8" height="8" fill="var(--violet-a8)" />
                      <line
                        x1="0"
                        y1="8"
                        x2="8"
                        y2="0"
                        stroke="rgba(255,255,255,0.25)"
                        strokeWidth="4"
                      />
                      <line
                        x1="-2"
                        y1="2"
                        x2="2"
                        y2="-2"
                        stroke="rgba(255,255,255,0.25)"
                        strokeWidth="4"
                      />
                      <line
                        x1="6"
                        y1="10"
                        x2="10"
                        y2="6"
                        stroke="rgba(255,255,255,0.25)"
                        strokeWidth="4"
                      />
                    </pattern>
                  </defs>
                  {!maxValue && (
                    <text
                      x={width / 2}
                      y={height / 2}
                      textAnchor="middle"
                      style={{
                        fontSize: 16,
                        fill: "var(--slate-11)",
                        opacity: 0.5,
                      }}
                    >
                      No data available
                    </text>
                  )}
                  <Group left={margin[3]} top={margin[0]}>
                    <BarStack
                      data={displayData}
                      keys={activeKeys}
                      x={(d) => d.t}
                      value={(d, key) => d.v[key] || 0}
                      xScale={xScale}
                      yScale={yScale}
                      color={colorScale}
                    >
                      {(barStacks) =>
                        barStacks.map((barStack) =>
                          barStack.bars.map((bar) => (
                            <rect
                              key={`bar-stack-${barStack.index}-${bar.index}`}
                              x={bar.x}
                              y={bar.y}
                              height={bar.height}
                              width={bar.width}
                              fill={
                                barStack.key === OTHER_KEY
                                  ? "url(#other-stripe)"
                                  : bar.color
                              }
                              data-test={bar.key}
                              style={{ pointerEvents: "none" }}
                            />
                          )),
                        )
                      }
                    </BarStack>
                    {(() => {
                      if (hoveredT === null) return null;
                      const barX = xScale(hoveredT);
                      const barW = xScale.bandwidth();
                      if (barX === undefined) return null;
                      const totalH = activeKeys.reduce((s, k) => {
                        const d = displayData.find((p) => p.t === hoveredT);
                        return s + yScale(0) - yScale(d?.v?.[k] ?? 0);
                      }, 0);
                      return (
                        <rect
                          x={barX - 2}
                          y={yMax - totalH - 2}
                          width={barW + 4}
                          height={totalH + 4}
                          fill="none"
                          stroke="var(--violet-9)"
                          strokeWidth={1.5}
                          rx={3}
                          style={{ pointerEvents: "none" }}
                        />
                      );
                    })()}
                    <rect
                      x={0}
                      y={0}
                      width={xMax}
                      height={yMax}
                      fill="transparent"
                      onMouseLeave={() => {
                        setHoveredT(null);
                        tooltipTimeout.current = window.setTimeout(
                          () => hideTooltip(),
                          300,
                        );
                      }}
                      onMouseMove={(event) => {
                        if (tooltipTimeout.current)
                          clearTimeout(tooltipTimeout.current);
                        const point = localPoint(event);
                        if (!point) return;
                        const mouseX = point.x - margin[3];
                        const bandwidth = xScale.bandwidth();
                        // Find nearest bar by comparing mouseX to each bar's center
                        let closestIdx = 0;
                        let minDist = Infinity;
                        xDomain.forEach((dt, i) => {
                          const center = (xScale(dt) ?? 0) + bandwidth / 2;
                          const dist = Math.abs(mouseX - center);
                          if (dist < minDist) {
                            minDist = dist;
                            closestIdx = i;
                          }
                        });
                        const t = xDomain[closestIdx];
                        const d = displayData.find((p) => p.t === t);
                        if (!d) return;
                        const barX = xScale(t) ?? 0;
                        setHoveredT(t);
                        showTooltip({
                          tooltipData: { bar: { data: d } },
                          tooltipTop: margin[0] - 70,
                          tooltipLeft: barX + margin[3] + bandwidth / 2,
                        });
                      }}
                    />
                  </Group>
                  {showAxes && (
                    <>
                      <AxisLeft
                        top={margin[0]}
                        left={margin[3] + 5}
                        scale={yScale}
                        tickFormat={(v) => formatter.format(v as number)}
                        stroke={"var(--violet-a4)"}
                        numTicks={4}
                        tickStroke={"var(--violet-a4)"}
                        tickLabelProps={() => ({
                          fill: "var(--violet-11)",
                          fontSize: 11,
                          textAnchor: "end",
                        })}
                      />
                      <AxisBottom
                        top={yMax + margin[0]}
                        left={margin[3]}
                        scale={xScale}
                        tickFormat={formatDate}
                        stroke={"var(--violet-a4)"}
                        numTicks={4}
                        tickStroke={"var(--violet-a4)"}
                        tickLabelProps={() => ({
                          fill: "var(--violet-11)",
                          fontSize: 11,
                          textAnchor: "middle",
                        })}
                      />
                    </>
                  )}
                </svg>
                {tooltipOpen && tooltipData && (
                  <TooltipWithBounds
                    top={tooltipTop}
                    left={tooltipLeft}
                    style={{
                      ...defaultStyles,
                      backgroundColor: "transparent",
                      boxShadow: "none",
                      padding: "0 20px",
                      zIndex: 1000,
                      pointerEvents: "none",
                      transition: "80ms all",
                    }}
                  >
                    <div
                      style={{
                        backgroundColor: "var(--slate-2)",
                        color: "var(--slate-12)",
                        borderRadius: 4,
                        padding: "10px",
                        boxShadow: "var(--shadow-4)",
                      }}
                    >
                      <Flex direction="column">
                        <Box
                          className="text-muted"
                          style={{ borderBottom: "1px solid var(--slate-6)" }}
                          pb="3"
                          mb="3"
                        >
                          {datetime(new Date(tooltipData.bar.data.t))}
                        </Box>
                        <Grid columns={"1fr 50px 40px"} gap="3">
                          {(() => {
                            const pointTotal = activeKeys.reduce(
                              (s, k) =>
                                s + (tooltipData.bar?.data?.v?.[k] || 0),
                              0,
                            );
                            return [...activeKeys]
                              .sort(legendSort)
                              .map((key) => {
                                const val =
                                  tooltipData.bar?.data?.v?.[key] || 0;
                                const pct =
                                  pointTotal > 0
                                    ? Math.round((val / pointTotal) * 100)
                                    : 0;
                                return (
                                  <Fragment key={key}>
                                    <Flex gap="1">
                                      <div
                                        className={
                                          key === OTHER_KEY
                                            ? styles.otherSwatch
                                            : undefined
                                        }
                                        style={swatchStyle(key)}
                                      />
                                      <OverflowText
                                        maxWidth={150}
                                        title={keyLabel(key)}
                                      >
                                        {keyLabel(key)}
                                      </OverflowText>
                                    </Flex>
                                    <div>
                                      <strong>{formatter.format(val)}</strong>
                                    </div>
                                    <div
                                      style={{
                                        color: "var(--slate-10)",
                                        fontSize: 11,
                                      }}
                                    >
                                      {pct}%
                                    </div>
                                  </Fragment>
                                );
                              });
                          })()}
                        </Grid>
                        {grandTotal > 0 && (
                          <Box
                            style={{
                              borderTop: "1px solid var(--slate-6)",
                              marginTop: 8,
                              paddingTop: 8,
                            }}
                          >
                            <Grid columns={"1fr 50px 40px"} gap="3">
                              <div style={{ fontWeight: 600 }}>Total</div>
                              <div>
                                <strong>
                                  {formatter.format(
                                    activeKeys.reduce(
                                      (s, k) =>
                                        s +
                                        (tooltipData.bar?.data?.v?.[k] || 0),
                                      0,
                                    ),
                                  )}
                                </strong>
                              </div>
                              <div />
                            </Grid>
                          </Box>
                        )}
                      </Flex>
                    </div>
                  </TooltipWithBounds>
                )}
              </div>
            );
          }}
        </ParentSizeModern>
        {showLegend && (
          <div className="mt-2">
            {grandTotal > 0 && (
              <Flex align="baseline" gap="1" mb="3" ml="2">
                <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
                  {formatter.format(grandTotal)}
                </span>
                <span style={{ fontSize: 12, color: "var(--slate-10)" }}>
                  total evaluations
                </span>
              </Flex>
            )}
            <LegendOrdinal
              scale={colorScale}
              labelFormat={(label) => `${label}`}
            >
              {(labels) => (
                <Flex gap="3" wrap={"wrap"} align="center">
                  {[...labels]
                    .sort((a, b) => legendSort(a.text, b.text))
                    .map((label, i) => {
                      const keyTotal =
                        label.text === OTHER_KEY
                          ? restKeys.reduce(
                              (s, k) => s + (keyTotals.get(k) ?? 0),
                              0,
                            )
                          : (keyTotals.get(label.text) ?? 0);
                      const pct =
                        grandTotal > 0
                          ? Math.round((keyTotal / grandTotal) * 100)
                          : 0;
                      return (
                        <LegendItem key={`legend-${i}`} margin="0 5px">
                          <LegendLabel align="left" margin="0 0 0 4px">
                            <Flex
                              gap="1"
                              align="center"
                              onClick={() => {
                                const next = new Set(disabledKeys);
                                if (next.has(label.text))
                                  next.delete(label.text);
                                else next.add(label.text);
                                if (next.size === displayKeys.length) return;
                                setDisabledKeys(next);
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              <div
                                className={
                                  label.text === OTHER_KEY
                                    ? styles.otherSwatch
                                    : undefined
                                }
                                style={{
                                  ...swatchStyle(label.text),
                                  marginRight: 5,
                                  opacity: disabledKeys.has(label.text)
                                    ? 0.4
                                    : 1,
                                }}
                              />
                              <OverflowText
                                maxWidth={150}
                                className={
                                  disabledKeys.has(label.text)
                                    ? "text-muted"
                                    : ""
                                }
                                title={keyLabel(label.text)}
                              >
                                {keyLabel(label.text)}
                              </OverflowText>
                              {grandTotal > 0 && (
                                <Flex
                                  gap="1"
                                  align="center"
                                  style={{ whiteSpace: "nowrap" }}
                                >
                                  <strong style={{ fontSize: 11 }}>
                                    {formatter.format(keyTotal)}
                                  </strong>
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: "var(--slate-10)",
                                    }}
                                  >
                                    ({pct}%)
                                  </span>
                                </Flex>
                              )}
                            </Flex>
                          </LegendLabel>
                        </LegendItem>
                      );
                    })}
                  {useGrouping && (
                    <Link onClick={() => setExpanded(true)} size="1">
                      expand
                    </Link>
                  )}
                  {groupTopN &&
                    !isBoolean &&
                    expanded &&
                    keys.length > TOP_N && (
                      <Link
                        onClick={() => {
                          setExpanded(false);
                          setDisabledKeys(new Set());
                        }}
                        size="1"
                      >
                        show fewer groups
                      </Link>
                    )}
                </Flex>
              )}
            </LegendOrdinal>
          </div>
        )}
      </div>
    </div>
  );
}

// Compact sparkline for the feature header.
// Booleans: byValue — false/null → gray, true → blue.
// Non-booleans: bySource — defaultValue → gray, all overrides → blue.
// Clicking opens the full usage analytics modal.
export function FeatureUsageSparkline({
  valueType,
  revision,
  environments,
}: {
  valueType: FeatureValueType;
  revision?: FeatureRevisionInterface;
  environments?: string[];
}) {
  const { sparkFeatureUsage, showFeatureUsage } = useFeatureUsage();
  const [modalOpen, setModalOpen] = useState(false);

  if (!showFeatureUsage) return null;

  const defaultBin = "default";
  const overrideBin = "override";
  const keys = [defaultBin, overrideBin];

  let displayData: { t: number; v: Record<string, number> }[];

  if (valueType === "boolean") {
    const raw = sparkFeatureUsage?.byValue ?? [];
    displayData = raw.map((d) => ({
      ...d,
      v: { [defaultBin]: d.v["false"] ?? 0, [overrideBin]: d.v["true"] ?? 0 },
    }));
  } else {
    const raw = sparkFeatureUsage?.bySource ?? [];
    const allSources = Array.from(
      new Set(raw.flatMap((d) => Object.keys(d.v))),
    );
    displayData = raw.map((d) => ({
      ...d,
      v: {
        [defaultBin]: d.v["defaultValue"] ?? 0,
        [overrideBin]: allSources
          .filter((s) => s !== "defaultValue")
          .reduce((sum, s) => sum + (d.v[s] || 0), 0),
      },
    }));
  }

  const colors = [booleanColors.false, booleanColors.true];
  const colorScale = scaleOrdinal({ domain: keys, range: colors });
  const xDomain = displayData.map((d) => d.t);
  const rawMaxValue = displayData.reduce((max, p) => {
    return Math.max(
      max,
      keys.reduce((s, k) => s + (p.v[k] || 0), 0),
    );
  }, 0);
  const hasData = rawMaxValue > 0;
  const maxValue = rawMaxValue || 1;

  const W = 90;
  const BOTTOM_PAD = 2;
  const H = 20;
  const AXIS_H = 1;
  const CHART_H = H - AXIS_H;

  const xScale = scaleBand({ domain: xDomain, range: [0, W], padding: 0.25 });
  const yScale = scaleLinear<number>({
    domain: [0, maxValue],
    range: [CHART_H, 0],
  });

  return (
    <>
      <Tooltip content="Usage analytics (15 minutes, live)">
        <Flex
          align="center"
          gap="1"
          onClick={() => setModalOpen(true)}
          className={styles.sparkTrigger}
        >
          <svg width={W} height={H + BOTTOM_PAD}>
            <defs>
              <linearGradient
                id="spark-pulse-grad"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="0%"
              >
                <stop offset="0%" stopColor="rgb(34,230,94)" stopOpacity={0} />
                <stop
                  offset="15%"
                  stopColor="rgb(34,230,94)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="35%"
                  stopColor="rgb(34,230,94)"
                  stopOpacity={0.85}
                />
                <stop offset="50%" stopColor="rgb(34,240,94)" stopOpacity={1} />
                <stop
                  offset="65%"
                  stopColor="rgb(34,230,94)"
                  stopOpacity={0.85}
                />
                <stop
                  offset="85%"
                  stopColor="rgb(34,230,94)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor="rgb(34,230,94)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            {!hasData ? (
              <text
                x={W / 2}
                y={CHART_H / 2 + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fill="var(--slate-9)"
              >
                no usage data
              </text>
            ) : (
              <BarStack
                data={displayData}
                keys={keys}
                x={(d) => d.t}
                value={(d, key) => d.v[key] || 0}
                xScale={xScale}
                yScale={yScale}
                color={colorScale}
              >
                {(barStacks) =>
                  barStacks.map((barStack) =>
                    barStack.bars.map((bar) => (
                      <rect
                        key={`spark-${barStack.index}-${bar.index}`}
                        x={bar.x + 0.5}
                        y={bar.y}
                        height={bar.height}
                        width={Math.max(0, bar.width - 1)}
                        fill={bar.color}
                      />
                    )),
                  )
                }
              </BarStack>
            )}
            <rect
              x={0}
              y={CHART_H}
              width={W}
              height={AXIS_H}
              fill="var(--slate-8)"
              rx={1}
            />
            <rect
              x={0}
              y={CHART_H + 2}
              width={72}
              height={2}
              fill="url(#spark-pulse-grad)"
              className={styles.sparkLivePulse}
              style={{ pointerEvents: "none" }}
            />
          </svg>
          <PiCaretRightBold className={styles.sparkCaret} />
        </Flex>
      </Tooltip>
      {modalOpen && (
        <Modal
          trackingEventModalType="feature-usage-sparkline"
          open={true}
          close={() => setModalOpen(false)}
          header="Usage Analytics"
          submit={undefined}
          closeCta="Close"
          size="lg"
        >
          <FeatureUsageContainer
            valueType={valueType}
            revision={revision}
            environments={environments}
            initialTab={valueType === "boolean" ? "value" : "source"}
          />
        </Modal>
      )}
    </>
  );
}
