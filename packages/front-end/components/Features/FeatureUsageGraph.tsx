import { BarStack } from "@visx/shape";
import { scaleBand, scaleLinear, scaleOrdinal } from "@visx/scale";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { LegendItem, LegendLabel, LegendOrdinal } from "@visx/legend";
import { AxisBottom, AxisLeft } from "@visx/axis";
import React, {
  createContext,
  Fragment,
  ReactNode,
  useContext,
  useEffect,
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
import { SeriesPoint } from "@visx/shape/lib/types";
import { datetime } from "shared/dates";
import stringify from "json-stringify-pretty-compact";
import useApi from "@/hooks/useApi";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { growthbook } from "@/services/utils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";

function generateTimeSeries(lookback: FeatureUsageLookback, keys: string[]) {
  const now = new Date();
  const start = new Date(now);
  start.setSeconds(0, 0);
  let step = 0;

  if (lookback === "15minute") {
    start.setMinutes(start.getMinutes() - 15);
    // One per minute
    step = 60 * 1000;
  } else if (lookback === "hour") {
    start.setHours(start.getHours() - 1);
    // One per 5 minutes
    step = 5 * 60 * 1000;
  } else if (lookback === "day") {
    start.setDate(start.getDate() - 1);
    // One per hour
    step = 60 * 60 * 1000;
  } else if (lookback === "week") {
    start.setDate(start.getDate() - 7);
    // One per 6 hours
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
          if (v.value) {
            values.add(v.value);
          }
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

const featureUsageContext = createContext<{
  lookback: FeatureUsageLookback;
  setLookback: (lookback: FeatureUsageLookback) => void;
  featureUsage: FeatureUsageData | undefined;
  showFeatureUsage: boolean;
  mutateFeatureUsage: () => void;
}>({
  lookback: "15minute",
  setLookback: () => {},
  showFeatureUsage: false,
  featureUsage: undefined,
  mutateFeatureUsage: () => {},
});

const categoricalColors = [
  "var(--teal-11)",
  "var(--indigo-8)",
  "var(--pink-11)",
  "var(--orange-8)",
  "var(--teal-8)",
  "var(--indigo-11)",
  "var(--pink-8)",
  "var(--orange-11)",
];
const booleanColors = {
  false: "var(--slate-8)",
  true: "var(--teal-11)",
};

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

  const hasGrowthbookClickhouseDatasource = datasources.find(
    (ds) => ds.type === "growthbook_clickhouse",
  )
    ? true
    : false;

  const showFeatureUsage =
    useDummyData ||
    (growthbook.isOn("feature-usage") && hasGrowthbookClickhouseDatasource);

  const { data, mutate: mutateFeatureUsage } = useApi<{
    usage: FeatureUsageData;
  }>(`/feature/${feature?.id}/usage?lookback=${lookback}`, {
    shouldRun: () => !!feature && showFeatureUsage && !useDummyData,
  });

  const featureUsage =
    useDummyData && feature ? getDummyData(feature, lookback) : data?.usage;

  const featureUsageAutoRefreshInterval = growthbook.getFeatureValue(
    "feature-usage-auto-refresh-interval",
    {
      withData: 0,
      withoutData: 0,
    },
  );

  useEffect(() => {
    if (!featureUsage) return;
    if (lookback !== "15minute") return;
    const hasData = featureUsage.bySource?.length > 0;
    const interval = hasData
      ? featureUsageAutoRefreshInterval["withData"]
      : featureUsageAutoRefreshInterval["withoutData"];

    if (interval === 0) return;

    const timer = setInterval(
      () => {
        mutateFeatureUsage();
      },
      // We might want to update slower when there's no data yet
      interval,
    );
    return () => clearInterval(timer);
  }, [
    lookback,
    featureUsage,
    featureUsageAutoRefreshInterval,
    mutateFeatureUsage,
  ]);

  return (
    <featureUsageContext.Provider
      value={{
        lookback,
        setLookback,
        showFeatureUsage,
        featureUsage,
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
}: {
  valueType: FeatureValueType;
  revision?: FeatureRevisionInterface;
  environments?: string[];
}) {
  const [tab, setTab] = useState<"source" | "value" | "rule">("value");

  const { featureUsage } = useFeatureUsage();

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
      <TabsList>
        <TabsTrigger value="value">By Value</TabsTrigger>
        <TabsTrigger value="source">By Source</TabsTrigger>
        <TabsTrigger value="rule">By Environment &amp; Rule</TabsTrigger>
      </TabsList>
      <TabsContent value="value">
        <FeatureUsageGraph
          data={featureUsage?.byValue}
          width="100%"
          height={150}
          showLegend={true}
          showAxes={true}
          formatLabel={(value) => {
            if (valueType === "string") {
              return `"${value}"`;
            }
            if (valueType === "json") {
              try {
                return stringify(JSON.parse(value));
              } catch (e) {
                // Do nothing
              }
            }

            return value;
          }}
          filterKeys={(key) => {
            if (valueType === "boolean" && !["false", "true"].includes(key))
              return false;
            return true;
          }}
        />
      </TabsContent>
      <TabsContent value="source">
        <FeatureUsageGraph
          data={featureUsage?.bySource}
          width="100%"
          height={150}
          showLegend={true}
          showAxes={true}
        />
      </TabsContent>
      <TabsContent value="rule">
        <FeatureUsageGraph
          data={featureUsage?.byRuleId}
          width="100%"
          height={150}
          showLegend={true}
          showAxes={true}
          filterKeys={(key) => {
            return ruleLabelMapping.has(key);
          }}
          formatLabel={(ruleId) => ruleLabelMapping.get(ruleId) || ruleId}
        />
      </TabsContent>
    </Tabs>
  );
}

type TooltipData = {
  bar: SeriesPoint<FeatureUsageDataPoint>;
  key: string;
  index: number;
  height: number;
  width: number;
  x: number;
  y: number;
  color: string;
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
}: {
  data: FeatureUsageDataPoint[] | undefined;
  width?: "auto" | string;
  height?: number;
  singleKey?: string;
  showLegend?: boolean;
  showAxes?: boolean;
  formatLabel?: (label: string) => string;
  filterKeys?: (key: string) => boolean;
}) {
  data = data?.filter(Boolean);

  const [disabledKeys, setDisabledKeys] = useState<Set<string>>(new Set());

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
    data?.forEach((d) => {
      Object.keys(d.v).forEach((key) => keySet.add(key));
    });
  }
  let keys = Array.from(keySet);
  if (filterKeys) {
    keys = keys.filter(filterKeys);
  }

  let colors = categoricalColors;
  if (keys.every((k) => ["true", "false"].includes(k))) {
    colors = keys.map((k) => booleanColors[k]);
  }

  const activeKeys = keys.filter((key) => !disabledKeys.has(key));

  const maxValue =
    data?.reduce((max, p) => {
      let total = 0;
      activeKeys.forEach((key) => {
        total += p.v[key] || 0;
      });
      return Math.max(max, total);
    }, 0) || 0;

  const yDomain = maxValue ? [0, maxValue] : [];
  const xDomain = data?.map((d) => d.t) || [];

  const colorScale = scaleOrdinal({
    domain: keys,
    range: colors,
  });

  const msRange = Math.max(...xDomain) - Math.min(...xDomain);
  function formatDate(d: number) {
    const date = new Date(d);
    if (msRange < 1000 * 60 * 60 * 24) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (msRange < 1000 * 60 * 60 * 24 * 7) {
      return date.toLocaleDateString([], {
        weekday: "short",
        hour: "numeric",
      });
    } else {
      return date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
      });
    }
  }

  let tooltipTimeout: number;

  return (
    <div style={{ marginBottom: -10, position: "relative" }}>
      <div style={{ width: width }}>
        <ParentSizeModern style={{ position: "relative" }}>
          {({ width }) => {
            const yMax = height - margin[0] - margin[2];
            const xMax = width - margin[1] - margin[3];
            const graphHeight = yMax;

            const xScale = scaleBand({
              domain: xDomain,
              range: [0, xMax],
              round: true,
              padding: 0.1,
            });
            const yScale = scaleLinear<number>({
              domain: yDomain,
              range: [graphHeight, 0],
              round: true,
            });

            return (
              <div
                className="border rounded mt-2"
                style={{ width, height, position: "relative" }}
              >
                <svg width={width} height={height}>
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
                      data={data}
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
                              fill={bar.color}
                              data-test={bar.key}
                              onMouseLeave={() => {
                                tooltipTimeout = window.setTimeout(() => {
                                  hideTooltip();
                                }, 800);
                              }}
                              onMouseMove={(event) => {
                                if (tooltipTimeout)
                                  clearTimeout(tooltipTimeout);
                                const eventSvgCoords = localPoint(event);
                                const left = bar.x + bar.width / 2;
                                showTooltip({
                                  tooltipData: bar,
                                  tooltipTop: eventSvgCoords?.y,
                                  tooltipLeft: left,
                                });
                              }}
                            />
                          )),
                        )
                      }
                    </BarStack>
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
                        tickLabelProps={() => {
                          return {
                            fill: "var(--violet-11)",
                            fontSize: 11,
                            textAnchor: "end",
                          };
                        }}
                      />
                      <AxisBottom
                        top={yMax + margin[0]}
                        left={margin[3]}
                        scale={xScale}
                        tickFormat={formatDate}
                        stroke={"var(--violet-a4)"}
                        numTicks={4}
                        tickStroke={"var(--violet-a4)"}
                        tickLabelProps={() => {
                          return {
                            fill: "var(--violet-11)",
                            fontSize: 11,
                            textAnchor: "middle",
                          };
                        }}
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
                      backgroundColor: "var(--slate-1)",
                      color: "var(--slate-12)",
                      borderRadius: 4,
                      padding: "10px",
                      zIndex: 1000,
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
                      <Grid columns={"1fr 50px"} gap="3">
                        {activeKeys.map((key) => (
                          <Fragment key={key}>
                            <Flex gap="1">
                              <div
                                style={{
                                  width: 15,
                                  height: 15,
                                  background: colorScale(key),
                                }}
                              ></div>

                              <OverflowText
                                maxWidth={150}
                                title={formatLabel ? formatLabel(key) : key}
                              >
                                {formatLabel ? formatLabel(key) : key}
                              </OverflowText>
                            </Flex>
                            <div>
                              <strong>
                                {formatter.format(
                                  tooltipData.bar?.data?.v?.[key] || 0,
                                )}
                              </strong>
                            </div>
                          </Fragment>
                        ))}
                      </Grid>
                    </Flex>
                  </TooltipWithBounds>
                )}
              </div>
            );
          }}
        </ParentSizeModern>
        {showLegend && (
          <div className="mt-2">
            <LegendOrdinal
              scale={colorScale}
              labelFormat={(label) => `${label}`}
            >
              {(labels) => (
                <Flex gap="3" wrap={"wrap"}>
                  {labels.map((label, i) => (
                    <LegendItem key={`legend-${i}`} margin="0 5px">
                      <LegendLabel align="left" margin="0 0 0 4px">
                        <Flex
                          gap="1"
                          align="center"
                          onClick={() => {
                            const newDisabledKeys = new Set(disabledKeys);
                            if (newDisabledKeys.has(label.text)) {
                              newDisabledKeys.delete(label.text);
                            } else {
                              newDisabledKeys.add(label.text);
                            }

                            if (newDisabledKeys.size === keys.length) {
                              return;
                            }

                            setDisabledKeys(newDisabledKeys);
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <div
                            style={{
                              background: label.value,
                              width: 15,
                              height: 15,
                              marginRight: 5,
                              opacity: disabledKeys.has(label.text) ? 0.4 : 1,
                            }}
                          ></div>
                          <OverflowText
                            maxWidth={150}
                            className={
                              disabledKeys.has(label.text) ? "text-muted" : ""
                            }
                            title={
                              formatLabel ? formatLabel(label.text) : label.text
                            }
                          >
                            {formatLabel
                              ? formatLabel(label.text)
                              : label.text || '""'}
                          </OverflowText>
                        </Flex>
                      </LegendLabel>
                    </LegendItem>
                  ))}
                </Flex>
              )}
            </LegendOrdinal>
          </div>
        )}
      </div>
    </div>
  );
}
