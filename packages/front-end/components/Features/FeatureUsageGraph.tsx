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
  FeatureUsageRowsByDimension,
  FeatureUsageRowsMeta,
  FeatureUsageSummary,
  FeatureValueType,
} from "shared/types/feature";
import { FeatureUsageLookback } from "shared/types/integrations";
import { isManagedWarehouseUnavailable, stemRuleId } from "shared/util";
import { useRouter } from "next/router";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { MinimalFeatureRevisionInterface } from "shared/validators";
import { defaultStyles, TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { datetime } from "shared/dates";
import stringify from "json-stringify-pretty-compact";
import { FaBoltLightning } from "react-icons/fa6";
import { PiCaretRightBold, PiXBold } from "react-icons/pi";
import useApi from "@/hooks/useApi";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { growthbook } from "@/services/utils";
import { useDefinitions } from "@/services/DefinitionsContext";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
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

function sumSeries(series: FeatureUsageDataPoint[]): number {
  return series.reduce(
    (total, point) => total + Object.values(point.v).reduce((s, v) => s + v, 0),
    0,
  );
}

function getDummyData(
  feature: FeatureInterface,
  lookback: FeatureUsageLookback,
  /** Forces total above the charted sum so the truncation disclosure renders. */
  truncate = false,
): FeatureUsageData {
  const ruleIds = new Set<string>();
  const sources = new Set<string>(["defaultValue"]);
  const values = new Set<string>([feature.defaultValue]);
  (feature.rules ?? []).forEach((rule) => {
    // Match real SDK telemetry: stem-stripped rule ids (see getFeatureDefinition)
    if (rule.id) ruleIds.add(stemRuleId(rule.id));
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
  const byValue = generateTimeSeries(lookback, Array.from(values));

  return {
    // The sum of what is actually charted, not an independent draw. An
    // unrelated random total made dummy mode show a ~54x gap against the
    // legend, which is a fake problem to design against.
    //
    // `?truncate=1` adds 20% on top, standing in for the real case where the
    // aggregate hit its LIMIT 200 cap — so the disclosure line below the legend
    // can be reviewed deliberately rather than never being seen.
    total: Math.round(sumSeries(byValue) * (truncate ? 1.2 : 1)),
    bySource: generateTimeSeries(lookback, Array.from(sources)),
    byValue,
    byRuleId: generateTimeSeries(lookback, Array.from(ruleIds)),
    // Two environments rather than one so the dimension has something to
    // stack; production dominates, as it does in real traffic.
    byEnvironment: generateTimeSeries(lookback, ["production", "staging"]),
  };
}

/** How many markers carry a visible label; the rest are lines only, on hover. */
const MAX_LABELLED_MARKERS = 3;
/** A label closer than this to the y-axis has nowhere to render legibly. */
const MARKER_LABEL_EDGE_PADDING = 28;

/**
 * Vertical dashed lines where a revision went live, drawn over the bars. This
 * is what connects a change in traffic to a change in config, so the lines are
 * always drawn — only the labels are rationed, because an unreadable label is
 * worse than none.
 */
function RevisionMarkers({
  revisions,
  domain,
  xForTime,
  height,
  width,
}: {
  revisions: MinimalFeatureRevisionInterface[];
  domain: [number, number];
  xForTime: (t: number) => number | null;
  height: number;
  width: number;
}) {
  const [min, max] = domain;
  const inDomain = revisions
    .filter((r) => r.status === "published" && r.datePublished)
    .map((r) => ({
      version: r.version,
      t: new Date(r.datePublished as unknown as string).getTime(),
    }))
    .filter((r) => r.t >= min && r.t <= max)
    // Newest first, so the labelled few are the most recent.
    .sort((a, b) => b.t - a.t);

  if (!inDomain.length) return null;

  return (
    <Group>
      {inDomain.map((rev, i) => {
        const x = xForTime(rev.t);
        if (x === null) return null;

        // Near the left edge the label would run into the axis, so the line
        // stands alone rather than carrying something unreadable.
        const tooCloseToAxis = x < MARKER_LABEL_EDGE_PADDING;
        // Near the right edge it would clip, so it flips to right-aligned
        // instead of overflowing the plot.
        const flipped = x > width - 60;
        const labelled = i < MAX_LABELLED_MARKERS && !tooCloseToAxis;

        return (
          <Group key={`${rev.version}-${rev.t}`}>
            <line
              x1={x}
              x2={x}
              y1={0}
              y2={height}
              stroke="var(--slate-a8)"
              strokeWidth={1}
              strokeDasharray="3,3"
            />
            <title>{`rev ${rev.version}`}</title>
            {labelled && (
              <text
                x={flipped ? x - 4 : x + 4}
                y={10}
                textAnchor={flipped ? "end" : "start"}
                fontSize={10}
                fill="var(--slate-11)"
              >
                {`rev ${rev.version}`}
              </text>
            )}
          </Group>
        );
      })}
    </Group>
  );
}

/**
 * Post-unification `revision.rules` is a flat `FeatureRule[]` rather than
 * `Record<env, rule[]>`. SDK payloads emit the STEM id on telemetry rows (see
 * `getFeatureDefinition`'s rule-id comment), so the map is keyed by stem —
 * otherwise rows whose rule id was `__env`-suffixed at flatten time would never
 * match any entry and get filtered out of the graph.
 *
 * Exported so a surface that renders the chart without this container labels
 * rule keys the same way rather than reimplementing the stem rule.
 */
export function buildRuleLabelMapping(
  revision?: FeatureRevisionInterface,
): Map<string, string> {
  const mapping = new Map<string, string>();
  const rules = Array.isArray(revision?.rules) ? revision.rules : [];
  // Holdout occupies rule slot #1 (matches Rule.tsx).
  const ruleNumberOffset = revision?.holdout ? 2 : 1;
  rules.forEach((rule, i) => {
    if (!rule.id) return;
    const stem = stemRuleId(rule.id);
    if (!mapping.has(stem)) {
      mapping.set(
        stem,
        rule.description?.trim() || `Rule #${i + ruleNumberOffset}`,
      );
    }
  });
  return mapping;
}

/** Flattens a bucketed series into the row shape the marginals arrive in. */
function toMarginalRows(
  series: FeatureUsageDataPoint[],
): { timestamp: string; group: string; evaluations: number }[] {
  const rows: { timestamp: string; group: string; evaluations: number }[] = [];
  series.forEach((point) => {
    const timestamp = new Date(point.t).toISOString();
    Object.entries(point.v).forEach(([group, evaluations]) => {
      if (evaluations > 0) rows.push({ timestamp, group, evaluations });
    });
  });
  return rows;
}

const formatter = Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const SPARK_LOOKBACK: FeatureUsageLookback = "15minute";
const OTHER_KEY = "(other)";
const TOP_N = 3;

/**
 * Cap on the DRAWN width of a stacked bar. The band scale divides the plot by
 * bucket count, so a short window (Last 15 minutes ≈ 15 buckets) would give
 * ~70px slabs. Past this the extra band is left as air rather than painted.
 *
 * Only the rect geometry is capped — the scale, band, domain and stack maths
 * are untouched, so hover, tooltips and the revision markers still address the
 * full band.
 */
const MAX_BAR_WIDTH = 24;

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
/**
 * KNOWN ACCESSIBILITY DEFECT — `false` fails contrast.
 *
 * rgb(170,170,170) lands around 1.6:1 against the panel surface, so "false"
 * segments are barely visible and a stacked bar's total cannot be read. The
 * validated replacement pair is violet #6e56cf / slate #8b8da3 (CVD ΔE 18.3,
 * both clear 3:1), which the Diagnostics tab now passes to
 * FeatureUsageContainer via its `colors` prop.
 *
 * These defaults are deliberately left alone because they are also the
 * sparkline's colours on the Overview tab (see FeatureUsageSparkline below),
 * and repainting a shipped surface deserves its own review rather than riding
 * along in a Diagnostics change. The defect is real on the sparkline too and is
 * still open — this is not "fine", it is scoped out.
 */
const booleanColors = {
  true: "rgb(32, 164, 240)",
  false: "rgb(170, 170, 170)",
};

/** Validated pair. See the contrast note above. */
export const ACCESSIBLE_BOOLEAN_COLORS = {
  true: "#6e56cf",
  false: "#8b8da3",
};

const featureUsageContext = createContext<{
  lookback: FeatureUsageLookback;
  setLookback: (lookback: FeatureUsageLookback) => void;
  featureUsage: FeatureUsageData | undefined;
  sparkFeatureUsage: FeatureUsageData | undefined;
  /** Window-independent; see the separate SWR key in the provider. */
  featureUsageSummary: FeatureUsageSummary | undefined;
  /** Per-dimension marginals, for surfaces that chart from a row table. */
  featureUsageRows: FeatureUsageRowsByDimension | undefined;
  featureUsageRowsMeta: FeatureUsageRowsMeta | undefined;
  /** When the usage response last arrived. Null before the first one. */
  usageUpdatedAt: Date | null;
  showFeatureUsage: boolean;
  managedWarehouseUnavailable: boolean;
  mutateFeatureUsage: () => void;
}>({
  lookback: "15minute",
  setLookback: () => {},
  showFeatureUsage: false,
  managedWarehouseUnavailable: false,
  featureUsage: undefined,
  sparkFeatureUsage: undefined,
  featureUsageSummary: undefined,
  featureUsageRows: undefined,
  featureUsageRowsMeta: undefined,
  usageUpdatedAt: null,
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
  const forceTruncation = router.query["truncate"] === "1";

  const [lookback, setLookback] = useLocalStorage<FeatureUsageLookback>(
    "featureUsageLookback",
    "15minute",
  );

  const { datasources } = useDefinitions();
  const growthbookManagedDatasource = datasources.find(
    (ds) => ds.type === "growthbook_clickhouse",
  );
  const managedWarehouseUnavailable = growthbookManagedDatasource
    ? isManagedWarehouseUnavailable(growthbookManagedDatasource)
    : false;
  const showFeatureUsage = useDummyData || !!growthbookManagedDatasource;

  const { data, mutate: mutateFeatureUsage } = useApi<{
    usage: FeatureUsageData;
    rowsByDimension: FeatureUsageRowsByDimension;
    rowsMeta: FeatureUsageRowsMeta;
  }>(`/feature/${feature?.id}/usage?lookback=${lookback}`, {
    shouldRun: () =>
      !!feature &&
      showFeatureUsage &&
      !useDummyData &&
      !managedWarehouseUnavailable,
  });

  const { data: sparkData, mutate: mutateSparkData } = useApi<{
    usage: FeatureUsageData;
  }>(`/feature/${feature?.id}/usage?lookback=${SPARK_LOOKBACK}`, {
    shouldRun: () =>
      !!feature &&
      showFeatureUsage &&
      !useDummyData &&
      !managedWarehouseUnavailable &&
      lookback !== SPARK_LOOKBACK,
  });

  // No lookback in the key, deliberately: these two numbers are
  // window-independent, so SWR caches them per feature and a lookback change
  // cannot re-run the scan for an answer that could not have moved.
  const { data: summaryData } = useApi<{ summary: FeatureUsageSummary }>(
    `/feature/${feature?.id}/usage-summary`,
    {
      shouldRun: () =>
        !!feature &&
        showFeatureUsage &&
        !useDummyData &&
        !managedWarehouseUnavailable,
    },
  );

  const featureUsage =
    useDummyData && feature
      ? getDummyData(feature, lookback, forceTruncation)
      : data?.usage;

  /**
   * Dummy mode has no endpoint to call, so the row table is derived from the
   * same synthetic series the sparkline uses — one row per bucket x key, which
   * is exactly the shape the real marginals arrive in.
   */
  const featureUsageRows: FeatureUsageRowsByDimension | undefined =
    useDummyData && featureUsage
      ? {
          value: toMarginalRows(featureUsage.byValue),
          source: toMarginalRows(featureUsage.bySource),
          ruleId: toMarginalRows(featureUsage.byRuleId),
          environment: toMarginalRows(featureUsage.byEnvironment),
        }
      : data?.rowsByDimension;

  const featureUsageRowsMeta: FeatureUsageRowsMeta | undefined =
    useDummyData && featureUsageRows
      ? (Object.fromEntries(
          Object.entries(featureUsageRows).map(([dimension, rows]) => [
            dimension,
            {
              cap: 25,
              returned: rows.length,
              // Nothing is withheld in dummy mode, so the disclosure below
              // stays hidden — the same as a real flag under the cap.
              includedEvaluations: rows.reduce(
                (sum, r) => sum + r.evaluations,
                0,
              ),
            },
          ]),
        ) as FeatureUsageRowsMeta)
      : data?.rowsMeta;

  /**
   * When the chart's data last arrived. Tracked here because only the provider
   * can see it: the usage response comes through SWR, so nothing on the page
   * observes the moment it lands, and a freshness stamp fed only by the table's
   * own query read "Not loaded yet" while the chart was already showing
   * numbers.
   *
   * Keyed on `data` rather than on the derived `featureUsage`, which is rebuilt
   * on every render in dummy mode and would loop. `lookback` is included so a
   * window change re-stamps even when the response is served from cache.
   */
  const [usageUpdatedAt, setUsageUpdatedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (!showFeatureUsage) return;
    if (useDummyData || data?.usage) setUsageUpdatedAt(new Date());
  }, [data, useDummyData, lookback, showFeatureUsage]);

  const featureUsageSummary: FeatureUsageSummary | undefined =
    useDummyData && feature
      ? {
          lastEvaluated: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
          lifetimeTotal: 16204,
          lookbackDays: 90,
        }
      : summaryData?.summary;

  const sparkFeatureUsage =
    useDummyData && feature
      ? getDummyData(feature, SPARK_LOOKBACK)
      : lookback === SPARK_LOOKBACK
        ? data?.usage
        : sparkData?.usage;

  const featureUsageAutoRefreshInterval = growthbook.getFeatureValue(
    "feature-usage-auto-refresh-interval",
    { withData: 5000, withoutData: 15000 },
  );

  useEffect(() => {
    if (managedWarehouseUnavailable) return;

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
    managedWarehouseUnavailable,
    mutateFeatureUsage,
    mutateSparkData,
  ]);

  return (
    <featureUsageContext.Provider
      value={{
        lookback,
        setLookback,
        featureUsageSummary,
        featureUsageRows,
        featureUsageRowsMeta,
        usageUpdatedAt,
        showFeatureUsage,
        managedWarehouseUnavailable,
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
  initialTab = "value",
  hideLookbackSelector = false,
  showEnvironmentTab = false,
  colors = booleanColors,
  revisions,
}: {
  valueType: FeatureValueType;
  revision?: FeatureRevisionInterface;
  initialTab?: "source" | "value" | "rule" | "environment";
  /**
   * For surfaces that own the time frame elsewhere. The chart still reads
   * `lookback` from context either way — this only hides the control, so there
   * is never a second time frame on screen disagreeing with the first.
   */
  hideLookbackSelector?: boolean;
  /**
   * Default is conservative rather than principled: this container also backs
   * the Overview sparkline's modal, and a new tab appearing there does not
   * belong in a Diagnostics change where nobody reviewing it is looking at that
   * surface. The modal probably should have it — whoever owns Overview can flip
   * this one word.
   */
  showEnvironmentTab?: boolean;
  /** Published revisions, for the markers. Omitted draws none. */
  revisions?: MinimalFeatureRevisionInterface[];
  /** See the contrast note on `booleanColors`. Defaults to today's pair. */
  colors?: { true: string; false: string };
}) {
  const [tab, setTab] = useState<"source" | "value" | "rule" | "environment">(
    initialTab,
  );
  const { featureUsage, lookback, setLookback, managedWarehouseUnavailable } =
    useFeatureUsage();
  const router = useRouter();
  const useDummyData = router.query["dummy"] === "true";

  // The callout is about a warehouse with no events in it, which says nothing
  // about synthetic data. Without this an org whose managed warehouse is still
  // provisioning would get the callout where the graph should be, even with
  // dummy data on. Non-dummy behaviour is unchanged.
  if (managedWarehouseUnavailable && !useDummyData) {
    return <ManagedWarehouseNoEventsCallout />;
  }

  // Post-unification `revision.rules` is a flat `FeatureRule[]` rather than
  // `Record<env, rule[]>`. SDK payloads emit the STEM id on telemetry rows
  // (see `getFeatureDefinition` rule-id comment), so we key the label map by
  // stem — otherwise rows whose rule id was `__env`-suffixed at flatten time
  // would never match any entry and get filtered out of the graph.
  const ruleLabelMapping = buildRuleLabelMapping(revision);

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
          {/* Was "By Environment & Rule". The query groups byRuleId on ruleId
              alone, so the old label promised a dimension the data never
              carried — this is a correctness fix, not a rename. */}
          <TabsTrigger value="rule">By Rule</TabsTrigger>
          {showEnvironmentTab && (
            <TabsTrigger value="environment">By Environment</TabsTrigger>
          )}
        </TabsList>
        {!hideLookbackSelector && (
          <Select
            size="md"
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
        )}
      </Flex>
      <TabsContent value="value">
        <FeatureUsageGraph
          colors={colors}
          revisions={revisions}
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
          colors={colors}
          revisions={revisions}
          data={featureUsage?.bySource}
          width="100%"
          height={225}
          showLegend={true}
          showAxes={true}
        />
      </TabsContent>
      <TabsContent value="rule">
        <FeatureUsageGraph
          colors={colors}
          revisions={revisions}
          data={featureUsage?.byRuleId}
          width="100%"
          height={225}
          showLegend={true}
          showAxes={true}
          filterKeys={(key) => ruleLabelMapping.has(key)}
          formatLabel={(ruleId) => ruleLabelMapping.get(ruleId) || ruleId}
        />
      </TabsContent>
      {showEnvironmentTab && (
        <TabsContent value="environment">
          {/* Its own dimension rather than crossed with rule: TOP_N is 3, so
              three rules across two environments would be six series and half
              would collapse into (other) immediately. On its own this is two or
              three series and answers "am I getting traffic where I expect". */}
          <FeatureUsageGraph
            colors={colors}
            revisions={revisions}
            data={featureUsage?.byEnvironment}
            width="100%"
            height={225}
            showLegend={true}
            showAxes={true}
          />
        </TabsContent>
      )}
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
  colors: colorPair = booleanColors,
  revisions,
  legendPosition = "bottom",
  showTotal = true,
  windowTotal,
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
  /**
   * The on/off pair. Defaults to `booleanColors`, which keeps every existing
   * caller — including the Overview sparkline — pixel-identical. See the
   * contrast note on that constant.
   */
  colors?: { true: string; false: string };
  /** Published revisions become dashed verticals. Omitted draws none. */
  revisions?: MinimalFeatureRevisionInterface[];
  /** "top" puts the legend above the plot, inside a framed container. */
  legendPosition?: "top" | "bottom";
  /**
   * The big number above the legend. Off for surfaces that print their own
   * total elsewhere — two totals for one window is the thing that made these
   * disagree in the first place.
   */
  showTotal?: boolean;
  /**
   * The true COUNT(*) for the window, when the caller knows it. The charted
   * rows are capped at the warehouse's LIMIT 200 by volume, so when this
   * exceeds their sum the shortfall is disclosed under the legend rather than
   * left for someone to discover by adding the legend up.
   */
  windowTotal?: number;
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
          ? colorPair.false
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
    if (isBoolean) return k === "true" ? 1 : 0; // false at bottom, true on top
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
    ? displayKeys.map((k) => colorPair[k as "true" | "false"])
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
    if (isBoolean) return k === "true" ? 0 : 1; // true first in legend, false second
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

  const notCharted =
    windowTotal !== undefined && windowTotal > grandTotal
      ? windowTotal - grandTotal
      : 0;

  const legendBlock = showLegend ? (
    <div className={legendPosition === "top" ? "mb-2" : "mt-2"}>
      {showTotal && grandTotal > 0 && (
        <Flex align="baseline" gap="1" mb="3" ml="2">
          <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
            {formatter.format(grandTotal)}
          </span>
          <span style={{ fontSize: 12, color: "var(--slate-10)" }}>
            total evaluations
          </span>
        </Flex>
      )}
      <LegendOrdinal scale={colorScale} labelFormat={(label) => `${label}`}>
        {(labels) => (
          <Flex gap="3" wrap={"wrap"} align="center">
            {[...labels]
              .sort((a, b) => legendSort(a.text, b.text))
              .map((label, i) => {
                const keyTotal =
                  label.text === OTHER_KEY
                    ? restKeys.reduce((s, k) => s + (keyTotals.get(k) ?? 0), 0)
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
                          if (next.has(label.text)) next.delete(label.text);
                          else next.add(label.text);
                          if (next.size === displayKeys.length) return;
                          setDisabledKeys(next);
                        }}
                        className={styles.legendItem}
                      >
                        <div
                          style={{
                            position: "relative",
                            marginRight: 5,
                            flexShrink: 0,
                          }}
                        >
                          <div
                            className={
                              label.text === OTHER_KEY
                                ? styles.otherSwatch
                                : undefined
                            }
                            style={{
                              ...swatchStyle(label.text),
                              opacity: disabledKeys.has(label.text) ? 0.25 : 1,
                            }}
                          />
                          {disabledKeys.has(label.text) && (
                            <PiXBold
                              style={{
                                position: "absolute",
                                inset: 0,
                                margin: "auto",
                                color: "var(--gray-11)",
                                pointerEvents: "none",
                              }}
                            />
                          )}
                        </div>
                        <Flex
                          align="end"
                          gap="1"
                          flexGrow="1"
                          style={{
                            minWidth: 0,
                            opacity: disabledKeys.has(label.text) ? 0.4 : 1,
                          }}
                        >
                          <OverflowText
                            maxWidth={150}
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
                              <Text size="sm" weight="semibold">
                                {formatter.format(keyTotal)}
                              </Text>
                              <Text size="sm" color="text-low">
                                ({pct}%)
                              </Text>
                            </Flex>
                          )}
                        </Flex>
                      </Flex>
                    </LegendLabel>
                  </LegendItem>
                );
              })}
            {useGrouping && (
              <Link onClick={() => setExpanded(true)} size="sm">
                expand
              </Link>
            )}
            {groupTopN && !isBoolean && expanded && keys.length > TOP_N && (
              <Link
                onClick={() => {
                  setExpanded(false);
                  setDisabledKeys(new Set());
                }}
                size="sm"
              >
                show fewer groups
              </Link>
            )}
          </Flex>
        )}
      </LegendOrdinal>
      {/* Only when the aggregate was actually truncated, so the common case
          stays clean. The exact difference, not a percentage: the point is that
          a specific number of evaluations is missing from the bars, and a
          percentage would need the reader to do the arithmetic back. */}
      {notCharted > 0 && (
        <Box mt="2" ml="2">
          <Text size="sm" color="text-low">
            {`Showing top 200 groups · ${formatter.format(
              notCharted,
            )} evaluations not charted`}
          </Text>
        </Box>
      )}
    </div>
  ) : null;

  return (
    <div style={{ marginBottom: -10, position: "relative" }}>
      <div style={{ width }}>
        {legendPosition === "top" ? legendBlock : null}
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
                      {(barStacks) => {
                        const numCols = barStacks[0]?.bars.length ?? 0;
                        return Array.from({ length: numCols }, (_, colIdx) => {
                          const colBars = barStacks
                            .map((stack) => ({
                              bar: stack.bars[colIdx],
                              stackKey: stack.key,
                            }))
                            .filter(({ bar }) => bar && bar.height > 0);
                          if (!colBars.length) return null;
                          const { bar: first } = colBars[0];
                          // Capped and centred in its band; see MAX_BAR_WIDTH.
                          const barWidth = Math.min(first.width, MAX_BAR_WIDTH);
                          const barX = first.x + (first.width - barWidth) / 2;
                          const topY = Math.min(
                            ...colBars.map(({ bar }) => bar.y),
                          );
                          const totalH =
                            Math.max(
                              ...colBars.map(({ bar }) => bar.y + bar.height),
                            ) - topY;
                          if (totalH <= 0) return null;
                          const clipId = `bar-clip-${colIdx}`;
                          return (
                            <g key={`col-${colIdx}`}>
                              <defs>
                                <clipPath id={clipId}>
                                  <rect
                                    x={barX}
                                    y={topY}
                                    width={barWidth}
                                    height={totalH}
                                    rx={4}
                                  />
                                </clipPath>
                              </defs>
                              <g clipPath={`url(#${clipId})`}>
                                {colBars.map(({ bar, stackKey }) => (
                                  <rect
                                    key={`bar-stack-${stackKey}-${colIdx}`}
                                    x={barX}
                                    y={bar.y}
                                    height={bar.height}
                                    width={barWidth}
                                    fill={
                                      stackKey === OTHER_KEY
                                        ? "url(#other-stripe)"
                                        : bar.color
                                    }
                                    data-test={bar.key}
                                    style={{ pointerEvents: "none" }}
                                  />
                                ))}
                              </g>
                            </g>
                          );
                        });
                      }}
                    </BarStack>
                    {revisions?.length && xDomain.length ? (
                      <RevisionMarkers
                        revisions={revisions}
                        domain={[xDomain[0], xDomain[xDomain.length - 1]]}
                        xForTime={(t) => {
                          // scaleBand has no inverse, so land the marker in the
                          // bucket that contains it and offset by how far
                          // through that bucket the publish actually fell.
                          let idx = xDomain.findIndex((d) => d > t) - 1;
                          if (idx < -1) idx = xDomain.length - 1;
                          if (idx < 0) return null;
                          const bandStart = xScale(xDomain[idx]);
                          if (bandStart === undefined) return null;
                          const next = xDomain[idx + 1];
                          const span = next ? next - xDomain[idx] : 0;
                          const frac = span ? (t - xDomain[idx]) / span : 0;
                          return (
                            bandStart +
                            xScale.bandwidth() * Math.min(Math.max(frac, 0), 1)
                          );
                        }}
                        height={yMax}
                        width={xMax}
                      />
                    ) : null}
                    {(() => {
                      if (hoveredT === null) return null;
                      const band = xScale(hoveredT);
                      if (band === undefined) return null;
                      // Rings the drawn bar rather than the band, which is now
                      // wider than the bar wherever the cap engages.
                      const barW = Math.min(xScale.bandwidth(), MAX_BAR_WIDTH);
                      const barX = band + (xScale.bandwidth() - barW) / 2;
                      const totalH = activeKeys.reduce((s, k) => {
                        const d = displayData.find((p) => p.t === hoveredT);
                        return s + yScale(0) - yScale(d?.v?.[k] ?? 0);
                      }, 0);
                      return (
                        <rect
                          x={barX - 2.5}
                          y={yMax - totalH - 2.5}
                          width={barW + 5}
                          height={totalH + 5}
                          fill="none"
                          stroke="var(--violet-a8)"
                          strokeWidth={2}
                          rx={5}
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
                        if (!maxValue) return;
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

                        const TOOLTIP_W = 280; // padding (40) + max content (~240)
                        const rawLeft = barX + margin[3] + bandwidth / 2;
                        showTooltip({
                          tooltipData: { bar: { data: d } },
                          tooltipTop: margin[0] - 70,
                          tooltipLeft:
                            rawLeft + TOOLTIP_W > width
                              ? Math.max(0, rawLeft - TOOLTIP_W)
                              : rawLeft,
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
                        stroke={"var(--gray-7)"}
                        numTicks={4}
                        tickStroke={"var(--gray-7)"}
                        tickLabelProps={() => ({
                          fill: "var(--gray-11)",
                          fontSize: 11,
                          textAnchor: "end",
                        })}
                      />
                      <AxisBottom
                        top={yMax + margin[0]}
                        left={margin[3]}
                        scale={xScale}
                        tickFormat={formatDate}
                        stroke={"var(--gray-7)"}
                        numTicks={4}
                        tickStroke={"var(--gray-7)"}
                        tickLabelProps={() => ({
                          fill: "var(--gray-11)",
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
        {legendPosition === "bottom" ? legendBlock : null}
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
}: {
  valueType: FeatureValueType;
  revision?: FeatureRevisionInterface;
}) {
  const { sparkFeatureUsage, showFeatureUsage, managedWarehouseUnavailable } =
    useFeatureUsage();
  const [modalOpen, setModalOpen] = useState(false);
  const router = useRouter();
  const useDummyData = router.query["dummy"] === "true";

  if (!showFeatureUsage || managedWarehouseUnavailable) return null;

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
  const H = 28;
  const AXIS_H = 1;
  const CHART_H = H - AXIS_H;

  const xScale = scaleBand({ domain: xDomain, range: [0, W], padding: 0.2 });
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
                {(barStacks) => {
                  const numCols = barStacks[0]?.bars.length ?? 0;
                  return Array.from({ length: numCols }, (_, colIdx) => {
                    const colBars = barStacks
                      .map((stack) => ({
                        bar: stack.bars[colIdx],
                        color: stack.bars[colIdx]?.color,
                      }))
                      .filter(({ bar }) => bar && bar.height > 0);
                    if (!colBars.length) return null;
                    const { bar: first } = colBars[0];
                    const x = first.x + 0.5;
                    const w = Math.max(0, first.width - 1);
                    const topY = Math.min(...colBars.map(({ bar }) => bar.y));
                    const totalH =
                      Math.max(
                        ...colBars.map(({ bar }) => bar.y + bar.height),
                      ) - topY;
                    if (totalH <= 0) return null;
                    const clipId = `spark-clip-${colIdx}`;
                    return (
                      <g key={`spark-col-${colIdx}`}>
                        <defs>
                          <clipPath id={clipId}>
                            <rect
                              x={x}
                              y={topY}
                              width={w}
                              height={totalH}
                              rx={1.5}
                            />
                          </clipPath>
                        </defs>
                        <g clipPath={`url(#${clipId})`}>
                          {colBars.map(({ bar, color }) => (
                            <rect
                              key={`spark-${colIdx}-${bar.y}`}
                              x={x}
                              y={bar.y}
                              height={bar.height}
                              width={w}
                              fill={color}
                            />
                          ))}
                        </g>
                      </g>
                    );
                  });
                }}
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
          useRadixButton={false}
          trackingEventModalType="feature-usage-sparkline"
          open={true}
          close={() => setModalOpen(false)}
          header={
            useDummyData ? (
              <Flex align="center" gap="2">
                Usage Analytics
                <Badge
                  label="Using dummy data"
                  color="cyan"
                  variant="soft"
                  size="sm"
                />
              </Flex>
            ) : (
              "Usage Analytics"
            )
          }
          submit={undefined}
          closeCta="Close"
          size="lg"
        >
          <FeatureUsageContainer
            valueType={valueType}
            revision={revision}
            initialTab={valueType === "boolean" ? "value" : "source"}
          />
        </Modal>
      )}
    </>
  );
}
