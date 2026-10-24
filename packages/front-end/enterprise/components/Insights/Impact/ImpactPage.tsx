import { useMemo, useState } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  calculateProductAnalyticsDateRange,
  filterCompletedExperiments,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import {
  ExperimentMetricDefinition,
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  isFactMetric,
} from "shared/experiments";
import { ago } from "shared/dates";
import useApi from "@/hooks/useApi";
import { useExperiments } from "@/hooks/useExperiments";
import { useCurrency } from "@/hooks/useCurrency";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperimentSearch } from "@/services/experiments";
import { formatNumber, getExperimentMetricFormatter } from "@/services/metrics";
import MetricSelector from "@/components/Experiment/MetricSelector";
import { isSingleValue } from "@/components/Forms/SelectField";
import ExperimentSearchFilters from "@/components/Search/ExperimentSearchFilters";
import LoadingSpinner from "@/components/LoadingSpinner";
import DateRangeCompareDropdown from "@/enterprise/components/ProductAnalytics/DateRangeCompareDropdown";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import PremiumCallout from "@/ui/PremiumCallout";
import ShareUrlPopover from "@/ui/ShareUrlPopover";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";
import { useInsightsUrlState } from "@/components/Insights/useInsightsUrlState";
import {
  buildCounterfactual,
  computeExperimentImpacts,
  sumValueByProject,
  summarizeImpact,
} from "./impactData";
import { useMetricSeries } from "./useMetricSeries";
import ImpactKpis from "./ImpactKpis";
import ImpactChart, { ImpactLane } from "./ImpactChart";
import ImpactExperimentsTable from "./ImpactExperimentsTable";
import ImpactByProject, { ProjectImpact } from "./ImpactByProject";
import MetricPickerPanel, { SuggestedMetric } from "./MetricPickerPanel";

const DAY_MS = 24 * 60 * 60 * 1000;

// The stats engine can't scale ratio or quantile effects to a total
function hasScaledImpact(m: ExperimentMetricDefinition): boolean {
  if (isFactMetric(m)) return !["ratio", "quantile"].includes(m.metricType);
  return !m.denominator;
}

function countBy(ids: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  return counts;
}

export default function ImpactPage() {
  const {
    ready,
    metricId,
    setMetricId,
    debias,
    setDebias,
    dateRange,
    setDateRange,
  } = useInsightsUrlState();
  const { hasCommercialFeature } = useUser();
  const {
    ready: definitionsReady,
    project,
    metricGroups,
    getExperimentMetricById,
    getFactMetricById,
    getFactTableById,
    getProjectById,
  } = useDefinitions();
  const displayCurrency = useCurrency();
  const { apiCall } = useAuth();
  const [calculating, setCalculating] = useState(false);

  const { experiments, loading: experimentsLoading } = useExperiments(
    project,
    true,
    "standard",
  );
  const {
    items: searched,
    searchInputProps,
    syntaxFilters,
    setSearchValue,
  } = useExperimentSearch({
    allExperiments: experiments,
    localStorageKey: "insights-impact",
  });
  const searchedIds = useMemo(
    () => new Set(searched.map((e) => e.id)),
    [searched],
  );

  const window = useMemo(
    () => calculateProductAnalyticsDateRange(dateRange),
    [dateRange],
  );
  const previousWindow = useMemo(
    () =>
      calculateProductAnalyticsDateRange(
        resolveComparisonPreviousTimeFrame(dateRange, {}),
      ),
    [dateRange],
  );
  const previousLabel = `vs previous ${Math.round(
    (window.endDate.getTime() - window.startDate.getTime()) / DAY_MS,
  )} days`;

  const metricIdsByExperiment = useMemo(
    () =>
      new Map(
        experiments.map((e) => [
          e.id,
          getAllMetricIdsFromExperiment(e, false, metricGroups),
        ]),
      ),
    [experiments, metricGroups],
  );
  const usesMetric = (e: ExperimentInterfaceStringDates) =>
    !!metricId && !!metricIdsByExperiment.get(e.id)?.includes(metricId);

  const completed = useMemo(
    () => filterCompletedExperiments(experiments, { ...window, projects: [] }),
    [experiments, window],
  );
  const previousCompleted = useMemo(
    () =>
      filterCompletedExperiments(experiments, {
        ...previousWindow,
        projects: [],
      }),
    [experiments, previousWindow],
  );
  const contributing = completed.filter(usesMetric);
  const previousContributing = previousCompleted.filter(usesMetric);

  // Metric options and suggestions come from what completed experiments used
  const metricCounts = useMemo(
    () =>
      countBy(completed.flatMap((e) => metricIdsByExperiment.get(e.id) ?? [])),
    [completed, metricIdsByExperiment],
  );
  const suggestions = useMemo<SuggestedMetric[]>(
    () =>
      [
        ...countBy(
          completed.flatMap((e) =>
            expandMetricGroups(e.goalMetrics ?? [], metricGroups),
          ),
        ).entries(),
      ]
        .sort((a, b) => b[1] - a[1])
        .flatMap(([id, count]) => {
          const m = getExperimentMetricById(id);
          if (!m || !hasScaledImpact(m)) return [];
          return [
            {
              id,
              name: m.name,
              typeLabel: isFactMetric(m)
                ? `Fact Metric · ${m.metricType}`
                : `Metric · ${m.type}`,
              count,
            },
          ];
        }),
    [completed, metricGroups, getExperimentMetricById],
  );

  const metricNote = (id: string): string | null => {
    const m = getExperimentMetricById(id);
    if (!m) return "Metric not found";
    if (!hasScaledImpact(m)) {
      return `${isFactMetric(m) && m.metricType === "quantile" ? "Quantile" : "Ratio"} metrics have no scaled impact`;
    }
    if (!metricCounts.get(id))
      return "No completed experiments in this date range";
    return null;
  };
  // Unused Fact Metrics stay selectable: the chart still shows their trend
  const isSelectable = (id: string) => {
    const m = getExperimentMetricById(id);
    return (
      !!m && hasScaledImpact(m) && (isFactMetric(m) || !!metricCounts.get(id))
    );
  };

  const snapshotIds = [
    ...new Set([...contributing, ...previousContributing].map((e) => e.id)),
  ].sort();
  const {
    data: snapshotData,
    isLoading: snapshotsLoading,
    mutate: mutateSnapshots,
  } = useApi<{ snapshots: ExperimentSnapshotInterface[] }>(
    `/experiments/snapshots?experiments=${snapshotIds
      .map(encodeURIComponent)
      .join(",")}`,
    { shouldRun: () => snapshotIds.length > 0 },
  );
  const snapshots = snapshotData?.snapshots ?? [];

  const metric = getExperimentMetricById(metricId);
  const inverse = !!metric?.inverse;
  // De-bias across all contributors so filtering doesn't move an estimate
  const rows = computeExperimentImpacts({
    experiments: contributing,
    snapshots,
    metricId,
    inverse,
    debias,
  });
  const filteredRows = rows.filter((r) => searchedIds.has(r.id));
  const previousRows = computeExperimentImpacts({
    experiments: previousContributing,
    snapshots,
    metricId,
    inverse,
    debias,
  }).filter((r) => searchedIds.has(r.id));
  const summary = summarizeImpact(filteredRows);
  const previousSummary = previousRows.some((r) => r.annualValue !== null)
    ? summarizeImpact(previousRows)
    : null;
  const missingScaledImpact = rows
    .filter((r) => r.missingScaledImpact)
    .map((r) => r.id);

  const allProjectTotals = sumValueByProject(rows);
  const filteredProjectTotals = sumValueByProject(filteredRows);
  const projectImpacts: ProjectImpact[] = [...allProjectTotals.keys()]
    .map((id) => ({
      id,
      name: id ? (getProjectById(id)?.name ?? id) : "No Project",
      value: filteredProjectTotals.get(id) ?? 0,
      filteredOut: !filteredProjectTotals.has(id),
    }))
    .sort(
      (a, b) =>
        Number(a.filteredOut) - Number(b.filteredOut) || b.value - a.value,
    );

  const lanes: ImpactLane[] = [
    ...filteredRows.flatMap((r): ImpactLane[] =>
      r.result !== "other" && r.startDate && r.annualValue !== null
        ? [
            {
              id: r.id,
              name: r.name,
              start: r.startDate,
              end: r.endDate,
              kind: r.result === "won" ? "shipped" : "rolledBack",
              row: r,
            },
          ]
        : [],
    ),
    ...searched.flatMap((e): ImpactLane[] => {
      const started = e.phases.find((p) => p.dateStarted)?.dateStarted;
      return e.status === "running" &&
        usesMetric(e) &&
        started &&
        new Date(started) < window.endDate
        ? [
            {
              id: e.id,
              name: e.name,
              start: new Date(started),
              end: null,
              kind: "running",
              row: null,
            },
          ]
        : [];
    }),
  ];

  const factMetric = getFactMetricById(metricId);
  const metricSeries = useMetricSeries(factMetric, dateRange);
  const counterfactual = metricSeries.series
    ? buildCounterfactual(metricSeries.series, filteredRows)
    : null;

  const formatter = metric
    ? getExperimentMetricFormatter(metric, getFactTableById, "number")
    : formatNumber;
  const formatValue = (v: number) =>
    formatter(v, { currency: displayCurrency });
  const formatAnnual = (v: number) =>
    formatter(v, {
      currency: displayCurrency,
      notation: "compact",
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });

  const calculateScaledImpact = async () => {
    setCalculating(true);
    try {
      await apiCall("/experiments/snapshots/scaled", {
        method: "POST",
        body: JSON.stringify({ experiments: missingScaledImpact }),
      });
      await mutateSnapshots();
    } finally {
      setCalculating(false);
    }
  };

  if (!ready || !definitionsReady) return <LoadingSpinner />;

  const hasMetric = !!metricId && !!metric;
  // Usually a link from another organization
  const unknownMetric = !!metricId && !metric;

  return (
    <Box className="container-fluid pagecontents" py="4">
      <Flex justify="between" align="start" mb="4" gap="4">
        <Box>
          <Heading as="h1" size="lg" mb="1">
            Impact Analysis
          </Heading>
          <Text color="text-mid">
            What experimentation earned: scaled impact, annualized and
            de-biased. For process metrics, see{" "}
            <Link href="/insights/health">Health</Link>.
          </Text>
        </Box>
        <ShareUrlPopover
          title="Share this view"
          description="Anyone with access to this organization sees the same metric, dates and filters."
          trigger={<Button disabled={!hasMetric}>Share</Button>}
        />
      </Flex>

      {!hasCommercialFeature("experiment-impact") ? (
        <PremiumCallout
          commercialFeature="experiment-impact"
          id="insights-impact"
        >
          Impact analysis is available to Enterprise customers.
        </PremiumCallout>
      ) : (
        <>
          <Flex
            className="appbox"
            mb="3"
            px="4"
            py="3"
            gap="4"
            align="center"
            wrap="wrap"
          >
            <Flex align="center" gap="2">
              <Text size="sm" weight="semibold" color="text-mid">
                METRIC
              </Text>
              <Box style={{ minWidth: 300 }}>
                <MetricSelector
                  value={hasMetric ? metricId : ""}
                  onChange={setMetricId}
                  includeFacts
                  placeholder="Select a metric"
                  containerClassName="mb-0"
                  optionNote={metricNote}
                  isOptionDisabled={(o) =>
                    isSingleValue(o) && !isSelectable(o.value)
                  }
                  sortMetrics={(a, b) =>
                    Number(isSelectable(b.id)) - Number(isSelectable(a.id)) ||
                    (metricCounts.get(b.id) ?? 0) -
                      (metricCounts.get(a.id) ?? 0)
                  }
                />
              </Box>
            </Flex>
            <DateRangeCompareDropdown
              value={{ dateRange, comparison: null }}
              onChange={(next) => setDateRange(next.dateRange)}
            />
            <Box flexGrow="1" />
            <Tooltip content="Adjusts winning lifts downward to correct for winner's curse. Applies to all figures on this page.">
              <Box>
                <Switch
                  value={debias}
                  onChange={setDebias}
                  disabled={!hasMetric}
                  label="De-bias estimates"
                />
              </Box>
            </Tooltip>
          </Flex>

          <Flex gap="3" align="center" mb="1" wrap="wrap">
            <Box flexGrow="1" style={{ maxWidth: 520 }}>
              <TextField
                placeholder="Filter which experiments count toward impact..."
                type="search"
                {...searchInputProps}
              />
            </Box>
            <ExperimentSearchFilters
              searchInputProps={searchInputProps}
              syntaxFilters={syntaxFilters}
              setSearchValue={setSearchValue}
              experiments={experiments}
              showStatusFilter={false}
            />
          </Flex>
          <Flex gap="2" mb="4" style={{ minHeight: 20 }}>
            {hasMetric && (
              <Text size="sm" color="text-mid">
                {filteredRows.length} of {rows.length} contributing experiments
              </Text>
            )}
            {(syntaxFilters.length > 0 || !!searchInputProps.value) && (
              <Link size="sm" onClick={() => setSearchValue("")}>
                Clear filters
              </Link>
            )}
          </Flex>

          {!hasMetric ? (
            <>
              {unknownMetric && (
                <Callout status="warning" mb="4">
                  The metric in this link isn&apos;t in this organization. Pick
                  a metric to see its impact.
                </Callout>
              )}
              <MetricPickerPanel
                suggestions={suggestions}
                counts={{
                  completed: completed.length,
                  won: completed.filter((e) => e.results === "won").length,
                  lost: completed.filter((e) => e.results === "lost").length,
                }}
                onSelect={setMetricId}
              />
            </>
          ) : experimentsLoading ||
            (snapshotIds.length > 0 && snapshotsLoading) ? (
            <LoadingSpinner />
          ) : (
            <>
              {missingScaledImpact.length > 0 && (
                <Callout
                  status="warning"
                  mb="4"
                  action={
                    <Button
                      color="inherit"
                      loading={calculating}
                      onClick={calculateScaledImpact}
                    >
                      Calculate scaled impact
                    </Button>
                  }
                >
                  {missingScaledImpact.length} experiment
                  {missingScaledImpact.length === 1 ? " is" : "s are"} missing
                  scaled impact results.
                </Callout>
              )}
              <ImpactKpis
                summary={summary}
                previous={previousSummary}
                previousLabel={previousLabel}
                debias={debias}
                format={formatAnnual}
              />
              {metricSeries.status === "success" && counterfactual ? (
                <>
                  <ImpactChart
                    title={metric.name}
                    points={counterfactual.points}
                    lift={counterfactual.lift}
                    liftCI={counterfactual.liftCI}
                    meanTotal={counterfactual.meanTotal}
                    lanes={lanes}
                    window={window}
                    debias={debias}
                    formatValue={formatValue}
                    formatAnnual={formatAnnual}
                  />
                </>
              ) : (
                <SeriesState
                  metric={metric}
                  status={metricSeries.status}
                  error={metricSeries.error}
                  canRun={metricSeries.canRun}
                  onRun={metricSeries.run}
                />
              )}
              {metricSeries.status === "success" &&
                metricSeries.lastUpdated && (
                  <Flex justify="end" gap="2" mt="-3" mb="4">
                    <Text size="sm" color="text-low">
                      Metric data updated {ago(metricSeries.lastUpdated)}
                    </Text>
                    {metricSeries.canRun && (
                      <Link size="sm" onClick={metricSeries.run}>
                        Refresh
                      </Link>
                    )}
                  </Flex>
                )}
              <Grid columns={{ initial: "1", md: "5" }} gap="4">
                <Box gridColumn={{ initial: "1", md: "span 3" }}>
                  <ImpactExperimentsTable
                    rows={filteredRows}
                    formatAnnual={formatAnnual}
                  />
                </Box>
                <Box gridColumn={{ initial: "1", md: "span 2" }}>
                  <ImpactByProject
                    projects={projectImpacts}
                    formatAnnual={formatAnnual}
                  />
                </Box>
              </Grid>
            </>
          )}
        </>
      )}
    </Box>
  );
}

const FACT_METRIC_TYPE_LABELS: Record<string, string> = {
  dailyParticipation: "daily participation",
};

function SeriesState({
  metric,
  status,
  error,
  canRun,
  onRun,
}: {
  metric: ExperimentMetricDefinition;
  status: ReturnType<typeof useMetricSeries>["status"];
  error: string | null;
  canRun: boolean;
  onRun: () => void;
}) {
  if (status === "unsupported") {
    return (
      <Callout status="info" mb="4">
        <strong>{metric.name}</strong>{" "}
        {isFactMetric(metric)
          ? `is a ${
              FACT_METRIC_TYPE_LABELS[metric.metricType] ?? metric.metricType
            } Fact Metric, and the impact chart only supports mean and proportion Fact Metrics.`
          : "is a legacy metric, and the impact chart only supports Fact Metrics."}{" "}
        The totals and experiments below still apply.
      </Callout>
    );
  }
  if (status === "loading" || status === "running") {
    return (
      <Flex className="appbox" mb="4" p="6" justify="center" gap="2">
        <LoadingSpinner />
        {status === "running" && (
          <Text color="text-mid">
            Loading this metric from the warehouse...
          </Text>
        )}
      </Flex>
    );
  }
  const message =
    status === "error"
      ? `The metric query failed: ${error ?? "unknown error"}`
      : status === "not-run"
        ? "There are no recent results for this metric and date range."
        : "This metric has no data in the date range.";
  return (
    <Callout
      status={status === "error" ? "error" : "info"}
      mb="4"
      action={
        canRun ? (
          <Button color="inherit" onClick={onRun}>
            {status === "error" ? "Try again" : "Run query"}
          </Button>
        ) : undefined
      }
    >
      {message}
      {!canRun &&
        " You don't have permission to query this metric's Data Source."}
    </Callout>
  );
}
