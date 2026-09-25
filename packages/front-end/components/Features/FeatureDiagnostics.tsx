import { FeatureInterface } from "shared/types/feature";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { OrganizationSettings } from "shared/types/organization";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  isProjectListValidForProject,
  isManagedWarehouseUnavailable,
  getActiveFeatureUsageQuery,
  stemRuleId,
} from "shared/util";
import { useRouter } from "next/router";
import { FeatureEvalDiagnosticsQueryResponseRows } from "shared/types/integrations";
import type { RowFilter } from "shared/types/fact-table";
import { ago, date, getValidDate } from "shared/dates";
import { QueryStatistics } from "shared/types/query";
import { Box } from "@radix-ui/themes";
import clsx from "clsx";
import { PiArrowClockwiseBold, PiClockBold } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import LinkButton from "@/ui/LinkButton";
import { useAddComputedFields, useSearch } from "@/services/search";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import EmptyState from "@/components/EmptyState";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import Table, { TableBody, TableCell, TableHeader, TableRow } from "@/ui/Table";
import StreamSearchField from "@/components/Diagnostics/StreamSearchField";
import TruncatedCell from "@/components/Diagnostics/TruncatedCell";
import StreamPagination, {
  STREAM_DEFAULT_ROWS_PER_PAGE,
} from "@/components/Diagnostics/StreamPagination";
import streamTableStyles from "@/components/Diagnostics/StreamTable.module.scss";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import { useFeatureUsage } from "@/components/Features/FeatureUsageGraph";
import { useEnvironments } from "@/services/features";
import FeatureDiagnosticsControlBar, {
  LOOKBACK_PRESETS,
  type EnvironmentOption,
} from "@/components/Features/FeatureDiagnosticsControlBar";
import DataCardHeader from "@/components/Diagnostics/DataCardHeader";
import FeatureEvaluationsCard from "@/components/Features/FeatureEvaluationsCard";
import styles from "./FeatureDiagnostics.module.scss";
import { dummyUserForRow } from "./featureDiagnosticsDummyUsers";
import {
  formatStreamTimestamp,
  MANAGED_STREAM_TABLE_COLUMNS,
  managedStreamColumnLabel,
  streamColumnLabel,
} from "./featureDiagnosticsStream";

type FeatureEvaluationDiagnosticsQueryResults = {
  rows?: FeatureEvalDiagnosticsQueryResponseRows;
  statistics?: QueryStatistics;
};

// Helper function to format a value for display
const formatDisplayValue = (value: unknown): string => {
  if (value === null) {
    return "null";
  } else if (value === undefined) {
    return "undefined";
  } else if (typeof value === "boolean") {
    return String(value);
  } else if (typeof value === "object") {
    return JSON.stringify(value);
  } else {
    return String(value);
  }
};

type DiagnosticsRow = FeatureEvalDiagnosticsQueryResponseRows[number] & {
  id: string;
};

const DUMMY_ROW_COUNT = 60;
const DUMMY_WINDOW_MS = 4 * 60 * 60 * 1000;
/** Every 7th row, so staging reads as the minority it is in real traffic. */
const DUMMY_STAGING_EVERY = 7;

/**
 * One template per distinct way this flag can evaluate. Source, value, ruleId
 * and variationId travel together rather than being sampled independently — a
 * row reading `source: defaultValue` beside another rule's value would be a
 * shape the SDK never emits, and this table exists to debug exactly that
 * correlation.
 *
 * Derived the same way as getDummyData() in FeatureUsageGraph.tsx, including
 * the stem-stripped rule ids that match real SDK telemetry.
 */
function getDummyRowTemplates(feature: FeatureInterface): Array<{
  value: string;
  source: string;
  ruleId: string;
  variationId: string;
}> {
  // Always present, and the whole list for a flag with no rules — which is the
  // case this must not render empty for.
  const templates = [
    {
      value: feature.defaultValue,
      source: "defaultValue",
      ruleId: "",
      variationId: "",
    },
  ];

  (feature.rules ?? []).forEach((rule) => {
    const ruleId = rule.id ? stemRuleId(rule.id) : "";
    if (rule.type === "force") {
      templates.push({
        value: rule.value,
        source: "force",
        ruleId,
        variationId: "",
      });
    } else if (rule.type === "rollout") {
      templates.push({
        value: rule.value,
        source: "rollout",
        ruleId,
        variationId: "",
      });
    } else if (rule.type === "experiment-ref") {
      rule.variations.forEach((v, i) => {
        templates.push({
          value: v.value,
          source: "experiment",
          ruleId,
          variationId: String(i),
        });
      });
    }
  });

  return templates;
}

/**
 * Column order for the evaluation stream, left to right after Timestamp.
 *
 * Follows the Log Stream widget's logic: when -> what happened -> where ->
 * details.
 *
 *  - `value` is the analog of Log Stream's Event column. It is the outcome, the
 *    thing people scan for, and it is the chart's default group-by, so the eye
 *    carries the same dimension from the chart into the table.
 *  - `source`, `ruleId` and `variationId` are one causal chain — how it was
 *    decided, which rule matched, which variation was served. Nothing may be
 *    inserted between them.
 *  - `environment` sits last because it is now the page scope. With one
 *    environment in the scope chip every row reads the same, and a constant
 *    column in second position is wasted prominence; it only carries
 *    information when several are selected.
 *
 * Keys not listed keep their arrival order at the end, so a new column from the
 * warehouse still appears rather than being silently dropped.
 */
const COLUMN_ORDER = [
  "value",
  "source",
  "ruleId",
  "variationId",
  "environment",
];

/**
 * Wide enough for the full timestamp, which must never truncate — it is the
 * sort column, and a clipped one is unreadable in a way the others are not.
 *
 * Measured rather than guessed: the widest `PPpp` string is 25 characters
 * ("Sep 21, 2026, 11:59:59 PM"), and at the cells' 12px monospace that is
 * ~183px, plus ui/Table's 12px of padding on each side.
 */
const TIMESTAMP_COLUMN_WIDTH = 210;

/**
 * The width `value` had before Timestamp grew: an equal share of what was left
 * over from the old 150px timestamp, across the five non-timestamp columns.
 *
 * Pinned as a calc() rather than a percentage or a px so it holds at any card
 * width — the table is fluid, so a fixed number would only be correct at one
 * size. The four columns that remain unsized are the ones that give up the
 * difference.
 */
const VALUE_COLUMN_WIDTH = "calc((100% - 150px) / 5)";

/**
 * Where the header bar comes to rest, and so the offset the pinned-state
 * observer measures against. Must match `top` on .stickyHeader — see the note
 * there for why it is 95 and what else that number is tied to.
 */
const STICKY_HEADER_TOP_PX = 95;

/**
 * Rows in the managed-warehouse shape from ClickHouse's
 * getFeatureEvalDiagnosticsQuery. Every managed column must be present: the
 * table shows the managed warehouse's fixed column set for these rows, so a key
 * missing here would render as an empty column.
 *
 * Templates are assigned round-robin rather than sampled, which guarantees
 * every source, value and rule id is visible in the table — a random draw can
 * miss one entirely on a flag with many rules.
 */
function getDummyDiagnosticsRows(feature: FeatureInterface): DiagnosticsRow[] {
  const templates = getDummyRowTemplates(feature);
  // Anchored at render so the newest row always reads as "just now" rather than
  // whenever this code was written.
  const now = Date.now();
  const step = DUMMY_WINDOW_MS / DUMMY_ROW_COUNT;

  return Array.from({ length: DUMMY_ROW_COUNT }, (_, i) => {
    const template = templates[i % templates.length];
    return {
      // Descending, so the table's default sort has nothing to undo.
      timestamp: new Date(now - i * step).toISOString(),
      feature_key: feature.id,
      environment: i % DUMMY_STAGING_EVERY === 0 ? "staging" : "production",
      value: template.value,
      source: template.source,
      ruleId: template.ruleId,
      variationId: template.variationId,
      // Fake identity and attributes — see featureDiagnosticsDummyUsers.
      ...dummyUserForRow(i),
      id: String(i),
    };
  });
}

function getDatasourceInitialFormValue(
  datasources: DataSourceInterfaceWithParams[],
  settings: OrganizationSettings,
  project?: string,
): { datasourceId: string } {
  const validDatasources = datasources.filter((d) =>
    isProjectListValidForProject(d.projects, project),
  );

  if (!validDatasources.length) return { datasourceId: "" };

  // Default to the first datasource with a feature usage query or managed warehouse.
  // If none found, fall back to the org default datasource.
  const initialId =
    validDatasources.find(
      (d) =>
        (d.type === "growthbook_clickhouse" &&
          !isManagedWarehouseUnavailable(d)) ||
        getActiveFeatureUsageQuery(d.settings?.queries?.featureUsage),
    )?.id || settings.defaultDataSource;

  const initialDatasource =
    (initialId && validDatasources.find((d) => d.id === initialId)) ||
    validDatasources[0];

  return {
    datasourceId: initialDatasource.id,
  };
}

export default function FeatureDiagnostics({
  feature,
  results,
  setResults,
}: {
  feature: FeatureInterface;
  results: Array<
    FeatureEvalDiagnosticsQueryResponseRows[number] & { id: string }
  > | null;
  setResults: (
    results: Array<
      FeatureEvalDiagnosticsQueryResponseRows[number] & { id: string }
    > | null,
  ) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSql, setErrorSql] = useState<string | null>(null);

  const router = useRouter();
  // Same param as FeatureUsageGraph's dummy path — one switch turns the whole
  // feature page into something demoable without a warehouse behind it.
  const useDummyData = router.query["dummy"] === "true";

  // No provider needed here: FeatureUsageProvider already wraps the whole
  // feature page, and this tab renders inside it.
  const {
    showFeatureUsage,
    lookback,
    setLookback,
    mutateFeatureUsage,
    featureUsage,
    featureUsageSummary,
    featureUsageRows,
    featureUsageRowsMeta,
    usageUpdatedAt,
  } = useFeatureUsage();

  const orgEnvironments = useEnvironments();

  /**
   * Environments relevant to THIS flag, as a union of two sets:
   *
   *  - enabled on the flag — it can receive evaluations, so a zero is worth
   *    reporting;
   *  - producing evaluations in the window — even when disabled.
   *
   * The first half keeps `dev` / `testing` out of a flag that was never turned
   * on there: they can never have evaluations, and listing them makes the
   * "none in this window" marker meaningless by attaching it to rows that could
   * never say anything else.
   *
   * The second half is the point of using a union rather than either alone. An
   * environment the flag is disabled in, still receiving evaluations, is an SDK
   * evaluating where it should not — the anomaly this picker most needs to
   * surface, and the one an enabled-only list would hide.
   */
  const evaluationsByEnvironment = useMemo(() => {
    const counts = new Map<string, number>();
    (featureUsageRows?.environment ?? []).forEach((row) => {
      counts.set(row.group, (counts.get(row.group) ?? 0) + row.evaluations);
    });
    return counts;
  }, [featureUsageRows]);

  const environmentOptions: EnvironmentOption[] = useMemo(
    () =>
      orgEnvironments
        .map((env) => ({
          id: env.id,
          enabled: !!feature.environmentSettings?.[env.id]?.enabled,
          evaluations: evaluationsByEnvironment.get(env.id) ?? 0,
        }))
        .filter((env) => env.enabled || env.evaluations > 0),
    [orgEnvironments, feature.environmentSettings, evaluationsByEnvironment],
  );

  /**
   * Defaults to everything relevant, and can never be emptied — the chip's
   * Apply refuses an empty selection, so this always names at least one.
   */
  const [selectedEnvironments, setSelectedEnvironments] = useState<string[]>(
    [],
  );
  const scopeInitialised = useRef(false);
  useEffect(() => {
    // Seeded once the options are known, then left alone so a later window
    // change cannot silently widen a scope the user narrowed.
    if (scopeInitialised.current || !environmentOptions.length) return;
    scopeInitialised.current = true;
    setSelectedEnvironments(environmentOptions.map((e) => e.id));
  }, [environmentOptions]);

  // Committed filters. Staged editing lives inside the control bar's popover;
  // this is only what the surface is actually filtered by.
  const [panelFilters, setPanelFilters] = useState<RowFilter[]>([]);
  // When the data on screen was fetched. SWR exposes no such timestamp, and a
  // null here is what the "Never run" stamp reads.
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  /**
   * The tab's freshness stamp covers both of its queries — the chart's usage
   * request and the table's — so it reports whichever landed last. Feeding it
   * only the table's query was the bug: the chart renders from SWR without ever
   * touching it, so the header claimed nothing had loaded while the chart was
   * showing a total.
   */
  const headerUpdatedAt = useMemo(() => {
    const stamps = [updatedAt, usageUpdatedAt].filter(
      (d): d is Date => d !== null,
    );
    if (!stamps.length) return null;
    return new Date(Math.max(...stamps.map((d) => d.getTime())));
  }, [updatedAt, usageUpdatedAt]);

  const { datasources, getDatasourceById } = useDefinitions();
  const settings = useOrgSettings();
  const { apiCall } = useAuth();

  const validDatasources = useMemo(() => {
    return datasources.filter((d) => {
      if (!isProjectListValidForProject(d.projects, feature.project))
        return false;
      return true;
    });
  }, [datasources, feature.project]);

  const form = useForm({
    defaultValues: {
      ...getDatasourceInitialFormValue(
        validDatasources,
        settings,
        feature.project,
      ),
    },
  });

  const datasourceId = form.watch("datasourceId");
  const datasource = datasourceId ? getDatasourceById(datasourceId) : null;

  const awaitingProvisioning = datasource
    ? isManagedWarehouseUnavailable(datasource)
    : false;

  // Managed warehouse natively supports diagnostics via its feature_usage table.
  // Event forwarder and regular datasources need a configured feature usage query.
  const datasourceHasFeatureUsageQuery =
    datasource &&
    !awaitingProvisioning &&
    (datasource.type === "growthbook_clickhouse" ||
      !!getActiveFeatureUsageQuery(datasource.settings?.queries?.featureUsage));

  // Synthesized once per feature rather than pushed through setResults: writing
  // to the page's state during render would be a side effect, and the real
  // query path should keep sole ownership of that state.
  const dummyResults = useMemo(
    () => (useDummyData ? getDummyDiagnosticsRows(feature) : null),
    [useDummyData, feature],
  );
  // Everything downstream reads this, so the table, search, sort and pagination
  // are the same code in both modes.
  const displayResults = useDummyData ? dummyResults : results;

  /**
   * The managed warehouse's projection is fixed, so its columns are a fixed
   * set in a fixed order. Environment is always on — the environment scope does
   * not reach the query, so rows from every environment arrive and the values
   * genuinely differ. Dummy rows mirror the managed shape.
   *
   * User ID and Variation each show only if some fetched row carries one. Read
   * from the whole result set, never the visible page, so they hold still
   * while paging and change only when the query re-runs.
   *
   * A generic data source wraps a query the customer wrote, where only
   * timestamp and feature_key are guaranteed, so its columns are still read
   * from the first row, exactly as before.
   */
  const managedStream =
    useDummyData || datasource?.type === "growthbook_clickhouse";

  const columns = useMemo(() => {
    if (displayResults === null || displayResults.length === 0) return [];
    const hasValues = (key: string) =>
      displayResults.some((row) => (row[key] ?? "") !== "");
    if (managedStream) {
      return [
        ...(hasValues("unit_id") ? ["unit_id"] : []),
        ...MANAGED_STREAM_TABLE_COLUMNS,
        ...(hasValues("variationId") ? ["variationId"] : []),
      ];
    }
    const keysSet = new Set<string>();
    // Only iterate over the first row since all rows have the same structure
    Object.keys(displayResults[0]).forEach((key) => {
      if (key !== "id" && key !== "timestamp" && key !== "feature_key") {
        keysSet.add(key);
      }
    });

    // Arrival order from the query is whatever the SELECT happened to list, so
    // it is sorted into the deliberate order above. Unlisted keys sort to the
    // end (index -1 -> length) and hold their arrival order between themselves,
    // since sort is stable.
    const rank = (key: string) => {
      const i = COLUMN_ORDER.indexOf(key);
      return i === -1 ? COLUMN_ORDER.length : i;
    };
    return Array.from(keysSet).sort((a, b) => rank(a) - rank(b));
  }, [displayResults, managedStream]);

  const evalItems = useAddComputedFields(
    displayResults ?? [],
    (row) => {
      const timestampDate = getValidDate(row.timestamp);
      // Compute display values for all columns
      const displayValues: Record<string, string> = {};
      columns.forEach((key) => {
        displayValues[key] = formatDisplayValue(row[key]);
      });

      return {
        timestamp: formatStreamTimestamp(row.timestamp, timestampDate),
        timestampSort: timestampDate.getTime(),
        ...displayValues,
      } as {
        timestamp: string;
        timestampSort: number;
      } & Record<string, string | number>;
    },
    [displayResults, columns],
  );

  // Values come from what is actually loaded, so the builder offers real
  // options rather than free text. Deliberately excludes userId (the search box
  // covers it) and timestamp (the time frame does).
  const columnSource = useMemo(() => {
    // No "environment": the scope chip in the control bar owns it. Two paths to
    // the same setting would need syncing and would drift — and the chip is the
    // better of the two, since it always has a value and lists environments the
    // flag is configured for.
    const filterable = ["value", "source", "ruleId", "variationId"];
    return {
      columns: filterable.map((c) => ({ label: c, value: c })),
      savedFilters: [],
      getColumnInfo: (column: string | undefined) => ({
        datatype: "string" as const,
        topValues: column
          ? [
              ...new Set(
                (displayResults ?? [])
                  .map((r) => r[column])
                  .filter(
                    (v): v is string => typeof v === "string" && v !== "",
                  ),
              ),
            ].sort()
          : [],
      }),
    };
  }, [displayResults]);

  // No `pageSize`: the hook's own pagination is a bare Pagination with a fixed
  // page size and no rows-per-page control. Paginating here instead — over the
  // rows it has already filtered and sorted — is what lets this share the Event
  // Logs footer, which is the same slice against host-owned state.
  const {
    items,
    SortableTableColumnHeader,
    searchInputProps,
    setSearchValue,
    isFiltered,
  } = useSearch({
    items: evalItems,
    defaultSortField: "timestampSort",
    defaultSortDir: -1,
    localStorageKey: "feature-diagnostics-v2",
    searchFields: ["timestamp", ...columns],
  });

  /**
   * Whether the header bar is currently pinned, which is what decides if it
   * carries the shadow for itself and the tabs above it.
   *
   * Kept in a callback ref rather than a useRef so the observer attaches when
   * the element appears — this component returns an empty state before the bar
   * exists, and a ref read once on mount would be null forever in that case.
   */
  const [stickySentinel, setStickySentinel] = useState<HTMLDivElement | null>(
    null,
  );
  const [headerStuck, setHeaderStuck] = useState(false);
  useEffect(() => {
    if (!stickySentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeaderStuck(!entry.isIntersecting),
      {
        root: null,
        rootMargin: `-${STICKY_HEADER_TOP_PX}px 0px 0px 0px`,
        threshold: 0,
      },
    );
    observer.observe(stickySentinel);
    return () => observer.disconnect();
  }, [stickySentinel]);

  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(STREAM_DEFAULT_ROWS_PER_PAGE);

  // Clamped rather than reset: a search that shrinks the result set below the
  // current page lands the reader on the last page instead of stranding them on
  // an empty one. The page count floors at 1 so an empty result is still page 1
  // of 1 rather than page 1 of 0.
  const pageCount = Math.max(1, Math.ceil(items.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const visibleItems = items.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage,
  );

  /**
   * An empty chart alone cannot tell these apart, which is the whole reason the
   * stat row exists. The discriminator is deliberately not "is the result
   * empty": "your flag is broken" and "your filter is too narrow" look
   * identical on the plot and need opposite responses from the reader.
   */
  const windowTotal = featureUsage?.total ?? 0;
  const lifetimeTotal = featureUsageSummary?.lifetimeTotal ?? 0;
  const filtersActive = panelFilters.length > 0 || isFiltered;
  // Both have to have landed before any of this is meaningful — judging off a
  // half-loaded pair would flash "stopped" on every page load.
  const usageLoaded = !!featureUsage && !!featureUsageSummary;

  /**
   * Past this, silence is a finding. Below it, silence is just a window
   * narrower than the gap between evaluations — on the shortest preset (15
   * minutes) a flag evaluating a few times an hour is legitimately quiet, and
   * calling that "stopped" asserts a conclusion the data does not support.
   */
  const STOPPED_GAP_MS = 24 * 60 * 60 * 1000;
  const lastEvaluatedMs = featureUsageSummary?.lastEvaluated
    ? new Date(featureUsageSummary.lastEvaluated).getTime()
    : null;
  const evaluationGapMs =
    lastEvaluatedMs === null ? null : Date.now() - lastEvaluatedMs;

  const diagnosticsState:
    | "loading"
    | "ok"
    | "never"
    | "stopped"
    | "quiet"
    | "filtered" = !usageLoaded
    ? "loading"
    : lifetimeTotal === 0
      ? "never"
      : windowTotal > 0
        ? "ok"
        : filtersActive
          ? "filtered"
          : evaluationGapMs !== null && evaluationGapMs > STOPPED_GAP_MS
            ? "stopped"
            : "quiet";

  // Names the window the person actually chose, rather than a fixed string that
  // would be wrong on three of the four presets.
  const windowLabel =
    LOOKBACK_PRESETS.find((p) => p.id === lookback)?.label.toLowerCase() ??
    "the selected window";

  /**
   * Latest-wins guard. A time-frame change re-runs the query while an earlier
   * run may still be in flight; only the newest response is allowed to land,
   * or a slow 7-day response could overwrite a fast 15-minute one under a
   * control that says "Last 15 minutes".
   */
  const queryRunRef = useRef(0);

  const onRunFeatureUsageQuery = async () => {
    const run = ++queryRunRef.current;
    setLoading(true);
    setError(null);
    setErrorSql(null);
    try {
      const results = await apiCall<FeatureEvaluationDiagnosticsQueryResults>(
        "/query/feature-eval-diagnostic",
        {
          method: "POST",
          body: JSON.stringify({
            feature: feature.id,
            datasourceId: form.watch("datasourceId"),
            // The window the control bar shows. Without it the endpoint falls
            // back to its historical 7 days, so the stream described a
            // different period from the one on screen.
            lookback,
          }),
        },
        (responseData) => {
          if (typeof responseData?.sql === "string") {
            setErrorSql(responseData.sql);
          }
        },
      );
      if (run !== queryRunRef.current) return;
      setUpdatedAt(new Date());
      if (results.rows) {
        const rowsWithId = results.rows.map((row, index) => ({
          ...row,
          id: index.toString(),
        }));
        setResults(rowsWithId);
      } else {
        setResults([]);
      }
    } catch (e) {
      if (run !== queryRunRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (run === queryRunRef.current) setLoading(false);
    }
  };

  /**
   * Rows on screen always describe the window the control shows. Once a query
   * has run, a time-frame change re-runs it; before the first run there is
   * nothing on screen to contradict the control, so nothing is spent.
   */
  const runQueryRef = useRef(onRunFeatureUsageQuery);
  runQueryRef.current = onRunFeatureUsageQuery;
  const lastQueriedLookback = useRef(lookback);
  useEffect(() => {
    if (lastQueriedLookback.current === lookback) return;
    lastQueriedLookback.current = lookback;
    if (results === null || useDummyData) return;
    runQueryRef.current();
  }, [lookback, results, useDummyData]);

  // Empty State: Prompt user to set up a data source to view diagnostics for this feature
  // Skipped under ?dummy=true, which is the case with no datasource at all.
  if (validDatasources.length === 0 && !useDummyData) {
    return (
      <Box className="contents container-fluid pagecontents">
        <EmptyState
          title="Feature Evaluation Diagnostics"
          description="Set up a data source to view diagnostics for this feature."
          leftButton={
            <LinkButton href="/datasources">Set up a Data Source</LinkButton>
          }
          rightButton={null}
        />
      </Box>
    );
  }

  return (
    <Box
      className="contents container-fluid pagecontents"
      // Overrides the 15px `.contents` gives every tab. Inline rather than a
      // class because `.contents` is a single class from global.scss and any
      // override of equal weight would win or lose on stylesheet order. Scoped
      // here so the other feature tabs keep their own spacing.
      //
      // Zero here because the 20px moved onto the sticky header below: padding
      // on this container scrolls away with the page, which let the title meet
      // the topbar once the header stuck.
      style={{ paddingTop: 0 }}
    >
      {/* Above the filter row, because Refresh re-runs the chart, the table
          and the filters — it cannot sit inside one of the things it
          refreshes. The stamp here is about the QUERY ("Refreshed"), which is
          a different fact from the data clock on the Evaluation Stream card
          below ("last evaluated"); they were contradicting each other while
          they shared a word. */}
      {/* A zero-height marker at the bar's resting position. A sticky element
          cannot report its own state in CSS, so "is it pinned" is read as
          "has this scrolled past the point the bar stops at" — the same
          sentinel-and-observer pattern FeaturesHeader uses for the tabs, and
          offset by the same number the bar sticks at. */}
      <div
        ref={setStickySentinel}
        aria-hidden
        style={{ height: 1, width: "100%", pointerEvents: "none" }}
      />
      <Box
        className={clsx(styles.stickyHeader, {
          [styles.stickyHeaderStuck]: headerStuck,
        })}
      >
        <DataCardHeader
          title="Feature Evaluations"
          // No rule under this one: the filter row below has its own bottom
          // border, and two lines that close together read as an empty band.
          showDivider={false}
          updatedAt={headerUpdatedAt}
          error={error ? new Error(error) : null}
          refreshing={loading}
          // "Run Query", not "Refresh": this spends a query against the
          // customer's warehouse, and "Refresh" implies something cheap and
          // instant. Matches ImportExperimentList's Title Case.
          //
          // Deliberately NOT state-dependent. The neighbouring Run Analysis /
          // Run Query buttons flip to "Refresh Data" / "Get New Data" once
          // results exist; here the second run costs exactly what the first did,
          // so a label implying otherwise would be a cost lie — and it would be
          // the label showing almost all the time.
          refreshLabel="Run Query"
          // Single clockwise arrow, bold weight. Note it is deliberately NOT the
          // plural PiArrowsClockwiseBold that DataCardHeader defaults to for
          // "Refresh" — the label beside it carries the cost meaning, so the icon
          // does not have to.
          refreshIcon={<PiArrowClockwiseBold aria-hidden />}
          // "Last run", not "Updated": "Updated" is the past tense of the verb
          // this button no longer uses, and it is ambiguous between the two
          // clocks on this page. "Last run" can only mean the query.
          freshnessVerb="Last run"
          freshnessEmptyLabel="Not run yet"
          // One step below the text beside it: the icon is a marker for what the
          // stamp is, not part of the value being read.
          freshnessIcon={
            <PiClockBold
              size={13}
              aria-hidden
              style={{ color: "var(--color-text-low)" }}
            />
          }
          onRefresh={() => {
            mutateFeatureUsage();
            onRunFeatureUsageQuery();
          }}
        />
      </Box>

      <FeatureDiagnosticsControlBar
        lookback={lookback}
        onLookbackChange={setLookback}
        environmentOptions={environmentOptions}
        selectedEnvironments={selectedEnvironments}
        onSelectedEnvironmentsChange={setSelectedEnvironments}
        filters={panelFilters}
        onFiltersChange={setPanelFilters}
        columnSource={columnSource}
      />

      {/* Already true under ?dummy=true, so this renders off the same synthetic
          data the table below does. Its own lookback selector is hidden: the
          control bar above owns the time frame, and two of them on one screen
          would eventually disagree. */}
      {showFeatureUsage && diagnosticsState === "never" && (
        <Callout status="info" mb="4">
          <Text size="md" weight="semibold">
            {`No evaluations in the last ${
              featureUsageSummary?.lookbackDays ?? 90
            } days`}
          </Text>
          {/* Bounded scan, so this cannot say "never" — only that nothing
              arrived inside the window it actually looked at. */}
          <Box mt="2" mb="1">
            <Text size="sm" color="text-mid">
              The usual causes:
            </Text>
          </Box>
          <ul className="mb-0 pl-4">
            <li>
              <Text size="sm" color="text-mid">
                The SDK is not reporting feature usage
              </Text>
            </li>
            <li>
              <Text size="sm" color="text-mid">
                {`Nothing references the key "${feature.id}"`}
              </Text>
            </li>
            <li>
              <Text size="sm" color="text-mid">
                No feature usage query is configured on the data source
              </Text>
            </li>
          </ul>
        </Callout>
      )}

      {showFeatureUsage &&
        diagnosticsState === "stopped" &&
        featureUsageSummary?.lastEvaluated && (
          <Callout status="warning" mb="4">
            {/* Date interpolated from lastEvaluated rather than written in:
                a hardcoded date would be wrong the day after it shipped. */}
            {`Evaluating normally until ${date(
              featureUsageSummary.lastEvaluated,
            )}, then stopped. Nothing has arrived in the selected time frame.`}
          </Callout>
        )}

      {showFeatureUsage &&
        diagnosticsState === "quiet" &&
        featureUsageSummary?.lastEvaluated && (
          <Callout status="info" mb="4">
            {/* States the gap; does not interpret it. Everything here is a
                measurement — the reader draws the conclusion. */}
            {`No evaluations in ${windowLabel}. Most recent was ${ago(
              featureUsageSummary.lastEvaluated,
            )}. Try a longer time frame.`}
          </Callout>
        )}

      {showFeatureUsage && diagnosticsState === "filtered" && (
        <Callout status="info" mb="4">
          No evaluations match this time frame. Try a longer time frame, or
          clear a filter.
        </Callout>
      )}

      {/* Skipped entirely when nothing has ever arrived: a flat empty plot
          adds noise to a state the callout above has already explained. */}
      {showFeatureUsage && diagnosticsState !== "never" && (
        <FeatureEvaluationsCard
          rowsByDimension={featureUsageRows}
          rowsMeta={featureUsageRowsMeta}
          total={featureUsage?.total ?? 0}
        />
      )}

      {!useDummyData && datasource && awaitingProvisioning && (
        <ManagedWarehouseNoEventsCallout />
      )}

      {!useDummyData &&
        datasource &&
        !awaitingProvisioning &&
        !datasourceHasFeatureUsageQuery && (
          <Callout status="info" mb="4">
            Feature Evaluation Diagnostics require setting up a feature usage
            query in your data source.
            <Link href={`/datasources/${datasource.id}`} ml="2">
              Setup a Feature Usage Query
            </Link>
          </Callout>
        )}

      {(useDummyData || (datasource && datasourceHasFeatureUsageQuery)) && (
        <Frame mt="4">
          {/* The same header the Event Logs stream uses: the title sits inline
              with the freshness stamp and Refresh, which describe this table
              rather than the filter row above it. */}
          {/* Title only. `actions={null}` rather than omitting it: the default
              right-hand group is a freshness stamp and a Refresh button, and
              the control bar above already owns both clocks and Run Query. */}
          <DataCardHeader title="Evaluation Stream" actions={null} />

          {/* Full width: it is the only control left on this card, and the
              control bar above owns time frame and filters.

              16px below. Nothing above it: the header's divider already carries
              a 16px bottom margin, and a margin here would stack on top of it
              rather than replace it. */}
          <Box mb="4">
            {/* Committed on blur or Enter rather than per keystroke, the same
                as the Event Logs stream. Here that is about the reader rather
                than about a request: filtering, re-sorting and re-paging on
                every character moves rows out from under the cursor while it
                is still being typed. */}
            <StreamSearchField
              value={searchInputProps.value}
              onChange={(v) => {
                setSearchValue(v);
                // A new search is a new result set, so it starts at its own
                // first page rather than wherever the last one had got to.
                setPage(1);
              }}
              placeholder="Search evaluations..."
            />
          </Box>
          {error && errorSql ? (
            <Box my="3">
              <DisplayTestQueryResults
                results={[]}
                duration={0}
                sql={errorSql}
                error={error}
                expandable={true}
              />
            </Box>
          ) : error ? (
            <Callout status="error" my="3">
              <strong>Error:</strong> {error}
            </Callout>
          ) : null}
          {/* Constant height across states, so committing a search that matches
              nothing does not collapse the card and pull the page up under the
              reader. Reserves a full page of rows: the 30px header plus 30px
              per row, from the current page size. */}
          <Box
            className={streamTableStyles.resultsArea}
            style={{ minHeight: 30 + rowsPerPage * 30 }}
          >
            {items.length === 0 && !error && (
              <Box className={streamTableStyles.resultsPlaceholder}>
                <EmptyState
                  title="No evaluations found"
                  description={
                    isFiltered
                      ? "Try a different search, or clear it to see every evaluation in this window"
                      : "Try a longer time frame, or removing a filter"
                  }
                  leftButton={null}
                  rightButton={null}
                />
              </Box>
            )}

            {items.length > 0 && (
              <>
                {/* The same dense table as the Event Logs stream: list variant,
                  30px rows, 12px monospace cells that truncate rather than
                  wrap. The styling is shared rather than copied — see
                  components/Diagnostics/StreamTable.module.scss. */}
                <Table
                  variant="list"
                  size="md"
                  className={streamTableStyles.streamTable}
                >
                  <TableHeader>
                    <TableRow>
                      {/* Radix header cells, not the legacy `<th>` SortableTH
                        renders — the shared module's rules target
                        `.rt-TableColumnHeaderCell`. Same props, same sort UI.

                        Widths sit on the header only: under the shared fixed
                        layout the first row decides the columns. Columns given
                        no width share whatever is left, evenly. */}
                      <SortableTableColumnHeader
                        field="timestampSort"
                        style={{ width: TIMESTAMP_COLUMN_WIDTH }}
                      >
                        Timestamp
                      </SortableTableColumnHeader>
                      {columns.map((key) => (
                        <SortableTableColumnHeader
                          key={key}
                          field={key}
                          // Only `value` is pinned; everything else stays
                          // unsized and absorbs what Timestamp took.
                          style={
                            key === "value"
                              ? { width: VALUE_COLUMN_WIDTH }
                              : undefined
                          }
                        >
                          {managedStream
                            ? managedStreamColumnLabel(key)
                            : streamColumnLabel(key)}
                        </SortableTableColumnHeader>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleItems.map((row) => (
                      <TableRow key={row.id}>
                        {/* Every column, not just the long ones: `value` holds
                            JSON on a non-boolean flag, and the timestamp clips
                            too once the card is narrow enough. */}
                        <TableCell>
                          <TruncatedCell value={String(row.timestamp)} />
                        </TableCell>
                        {columns.map((key) => (
                          <TableCell key={key}>
                            <TruncatedCell value={String(row[key] ?? "")} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <StreamPagination
                  numItemsTotal={items.length}
                  perPage={rowsPerPage}
                  setPerPage={setRowsPerPage}
                  currentPage={currentPage}
                  onPageChange={setPage}
                  pullBottom
                />
              </>
            )}
          </Box>
        </Frame>
      )}
    </Box>
  );
}
