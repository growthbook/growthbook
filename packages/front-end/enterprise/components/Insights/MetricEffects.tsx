import React, { useEffect, useState, useMemo, ReactNode } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  ExperimentSnapshotInterface,
  ExperimentWithSnapshot,
} from "shared/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { Box, Flex, Text } from "@radix-ui/themes";
import { DifferenceType } from "shared/types/stats";
import { useRouter } from "next/router";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { useExperiments } from "@/hooks/useExperiments";
import MetricSelector from "@/components/Experiment/MetricSelector";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  formatNumber,
  formatPercent,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import {
  filterExperimentsByMetrics,
  updateSearchParams,
} from "@/enterprise/components/Insights/MetricCorrelations";
import HistogramGraph from "@/components/MetricAnalysis/HistogramGraph";
import MetricExperiments from "@/components/MetricExperiments/MetricExperiments";
import { useCurrency } from "@/hooks/useCurrency";
import { useUser } from "@/services/UserContext";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import EmptyState from "@/components/EmptyState";
import LinkButton from "@/ui/LinkButton";
import Callout from "@/ui/Callout";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import useApi from "@/hooks/useApi";
import { useExperimentSearch } from "@/services/experiments";
import ExperimentSearchFilters from "@/components/Search/ExperimentSearchFilters";
import Field from "@/components/Forms/Field";
import Link from "@/ui/Link";
import LoadingOverlay from "@/components/LoadingOverlay";

interface HistogramDatapoint {
  start: number;
  end: number;
  units: number;
}

function createHistogramData(values: number[]): HistogramDatapoint[] {
  if (values.length === 0) return [];

  let minVal = Math.min(...values);
  let maxVal = Math.max(...values);

  // compute number of bins
  const numBins = Math.max(5, Math.min(20, Math.ceil(values.length ** 0.68)));

  if (minVal === maxVal) {
    const center = minVal;
    const spread = Math.abs(center * 0.05) || 0.5; // 5% spread or 0.5 absolute
    minVal = center - spread;
    maxVal = center + spread;
  }

  // Ensure minVal and maxVal are different to prevent division by zero for binSize
  if (minVal === maxVal) {
    minVal = minVal - 0.5; // Create a minimal range
    maxVal = maxVal + 0.5;
  }

  const binSize = (maxVal - minVal) / numBins;
  let bins: HistogramDatapoint[] = [];

  // Adjustment to make bins cut at 0
  let binAdjustment = 0;
  for (let i = 0; i < numBins; i++) {
    const binStart = minVal + i * binSize;
    const binEnd = minVal + (i + 1) * binSize;
    if (binStart < 0 && binEnd > 0) {
      binAdjustment = binEnd;
    }
    bins.push({ start: binStart, end: binEnd, units: 0 });
  }
  bins = bins.map((bin) => {
    bin.start = bin.start - binAdjustment;
    bin.end = bin.end - binAdjustment;
    return bin;
  });
  bins.push({
    start: bins[bins.length - 1].end,
    end: bins[bins.length - 1].end + binSize,
    units: 0,
  });

  for (const value of values) {
    // Assign each value to the displayed bin whose (already shifted) [start, end)
    // range actually contains it, so counts always match the rendered edges.
    let binIndex = bins.findIndex((b) => value >= b.start && value < b.end);
    if (binIndex === -1) {
      // Outside the displayed range (e.g. the max value or float edge): clamp to an end bin.
      binIndex = value < bins[0].start ? 0 : bins.length - 1;
    }
    bins[binIndex].units++;
  }
  return bins;
}

type MetricEffectParams = {
  idx: number;
  metric: string;
  diff: DifferenceType;
};

const parseQueryParams = (
  query: Record<string, string | string[] | undefined>,
): MetricEffectParams[] => {
  const params: MetricEffectParams[] = [];
  const paramGroups = new Map<string, MetricEffectParams>();

  // First pass: collect all parameters and group them by their ID
  Object.entries(query).forEach(([key, value]) => {
    if (typeof value !== "string") return;

    const match = key.match(/^(metric|diff)(?:_(.+))?$/);
    if (!match) return;

    const [, paramType, id] = match;
    const idx = Number(id);

    if (!Number.isInteger(idx)) return;
    const groupId = idx.toString();

    if (!paramGroups.has(groupId)) {
      paramGroups.set(groupId, { idx, metric: "", diff: "relative" });
    }

    const group = paramGroups.get(groupId)!;
    if (paramType === "metric") group.metric = value;
    else if (paramType === "diff") group.diff = value as DifferenceType;
  });

  // Convert groups to array and filter out incomplete groups
  paramGroups.forEach((group) => {
    if (group.metric) {
      params.push(group);
    }
  });

  return params.sort((a, b) => a.idx - b.idx);
};

const MetricEffects = (): React.ReactElement => {
  const router = useRouter();
  const qParams = router.query;

  const params = parseQueryParams(qParams);

  const {
    experiments: allExperiments,
    loading: experimentsLoading,
    error: experimentsError,
  } = useExperiments("", true, "standard");

  const {
    items: filteredExperiments,
    searchInputProps,
    syntaxFilters,
    setSearchValue,
  } = useExperimentSearch({
    allExperiments,
    localStorageKey: "metric-effects-experiments",
  });

  const { hasCommercialFeature } = useUser();
  const hasMetricEffectsCommercialFeature =
    hasCommercialFeature("metric-effects");

  const { theme } = useAppearanceUITheme();
  const computedTheme = theme === "light" ? "light" : "dark";
  const { metrics, factMetrics, datasources } = useDefinitions();

  // Counts use the full experiment list (ignoring user filters) so the metric
  // dropdown options stay stable as the user adjusts filters.
  const metricExpCounts = useMetricExpCounts(allExperiments);

  if (!hasMetricEffectsCommercialFeature) {
    return (
      <Box mb="3">
        <PremiumEmptyState
          title="Metric Effects"
          description="View the distribution of experiment effects on your metrics."
          commercialFeature="metric-effects"
          learnMoreLink="https://docs.growthbook.io/app/metrics" //<- fix this link when docs are ready
          image={`/images/empty-states/metric_effects_${computedTheme}.png`}
        />
      </Box>
    );
  }

  if (experimentsLoading) {
    return <LoadingOverlay />;
  }

  if (experimentsError) {
    return (
      <Callout status="error">
        An error occurred loading experiments: {experimentsError.message}
      </Callout>
    );
  }

  if (
    !datasources.length ||
    (!metrics.length && !factMetrics.length) ||
    Object.keys(metricExpCounts).length === 0
  ) {
    let button: ReactNode;
    if (!datasources.length) {
      button = <LinkButton href="/datasources">Add Data Source</LinkButton>;
    } else if (!metrics.length && !factMetrics.length) {
      button = <LinkButton href="/metrics">Create Metric</LinkButton>;
    } else {
      button = <LinkButton href="/experiments">Create Experiment</LinkButton>;
    }

    return (
      <Box mb="3">
        <EmptyState
          title="Metric Effects"
          description="View the distribution of experiment effects on your metrics."
          image={`/images/empty-states/metric_effects_${computedTheme}.png`}
          leftButton={button}
          rightButton={null}
        />
      </Box>
    );
  }

  const showClearFilters = syntaxFilters.length > 0 || !!searchInputProps.value;

  return (
    <Box>
      <Flex gap="4" align="start" justify="between" mb="4" wrap="wrap">
        <Flex align="center" gap="3">
          <Box flexBasis="300px" flexShrink="0">
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
          </Box>
          {showClearFilters && (
            <Link
              size="1"
              onClick={() => setSearchValue("")}
              style={{ whiteSpace: "nowrap" }}
            >
              Clear filters
            </Link>
          )}
        </Flex>
        <ExperimentSearchFilters
          searchInputProps={searchInputProps}
          syntaxFilters={syntaxFilters}
          setSearchValue={setSearchValue}
          experiments={allExperiments}
          showStatusFilter={false}
        />
      </Flex>
      <MetricEffectCard
        filteredExperiments={filteredExperiments}
        allExperiments={allExperiments}
        metricExpCounts={metricExpCounts}
        params={params[0] || undefined}
      />
    </Box>
  );
};

function useMetricExpCounts(experiments: ExperimentInterfaceStringDates[]) {
  const { metricGroups } = useDefinitions();

  const metricExpCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    experiments.forEach((exp) => {
      if (exp.status === "draft") return;
      getAllMetricIdsFromExperiment(exp, false, metricGroups).forEach(
        (metric) => {
          counts[metric] = (counts[metric] || 0) + 1;
        },
      );
    });
    return counts;
  }, [experiments, metricGroups]);

  return metricExpCounts;
}

const MetricEffectCard = ({
  filteredExperiments,
  allExperiments,
  metricExpCounts,
  params,
}: {
  filteredExperiments: ExperimentInterfaceStringDates[];
  allExperiments: ExperimentInterfaceStringDates[];
  metricExpCounts: Record<string, number>;
  params?: MetricEffectParams;
}): React.ReactElement => {
  const { project, getExperimentMetricById, getFactTableById, metricGroups } =
    useDefinitions();

  const displayCurrency = useCurrency();

  const [metric, setMetric] = useState<string>(params?.metric || "");
  const [differenceType, setDifferenceType] = useState<DifferenceType>(
    params?.diff || "relative",
  );

  // Keep URL query params in sync with selected metric / diff type so a deep
  // link reproduces the same view. Only run when user-controlled values change
  // (not on filtered experiment list updates).
  useEffect(() => {
    if (!metric) return;
    updateSearchParams(
      {
        metric_0: metric,
        diff_0: differenceType,
      },
      false,
    );
  }, [metric, differenceType]);

  const metricObj = getExperimentMetricById(metric);

  const formatterM1 = !metricObj
    ? formatPercent
    : differenceType === "relative"
      ? formatPercent
      : getExperimentMetricFormatter(
          metricObj,
          getFactTableById,
          differenceType === "absolute" ? "percentagePoints" : "number",
        );

  const formatterOptions: Intl.NumberFormatOptions = {
    currency: displayCurrency,
    ...(differenceType === "relative" ? { maximumFractionDigits: 1 } : {}),
    ...(differenceType === "scaled" ? { notation: "compact" } : {}),
  };

  // All experiments (regardless of user filter) that include the selected
  // metric. This drives the snapshot fetch so its cache key stays stable as
  // the user adjusts the experiment filter.
  const allExperimentsWithMetric = useMemo(() => {
    if (!metric) return [];
    return filterExperimentsByMetrics(
      allExperiments,
      metric,
      undefined,
      metricGroups,
    );
  }, [allExperiments, metric, metricGroups]);

  // Set of experiment ids that pass the user's current search/filter — used
  // to narrow the snapshot results in memory without invalidating the cache.
  const filteredExperimentIds = useMemo(
    () => new Set(filteredExperiments.map((e) => e.id)),
    [filteredExperiments],
  );

  // Stable, comma-separated id list used both as the SWR cache key and the
  // request payload. Sorting ensures the cache key doesn't churn when the
  // input order changes.
  const snapshotQueryIds = useMemo(
    () =>
      allExperimentsWithMetric
        .map((e) => e.id)
        .sort()
        .map(encodeURIComponent)
        .join(","),
    [allExperimentsWithMetric],
  );

  const snapshotsKey = snapshotQueryIds
    ? `/experiments/snapshots/?experiments=${snapshotQueryIds}`
    : "";
  const { data: snapshotsData, error: snapshotsError } = useApi<{
    snapshots: ExperimentSnapshotInterface[];
  }>(snapshotsKey, {
    shouldRun: () => !!snapshotsKey,
    autoRevalidate: false,
  });

  // Loading is "true" only while we have a metric selected and the snapshot
  // fetch is still pending. We intentionally do not show a spinner when the
  // user hasn't picked a metric yet.
  const snapshotsLoading =
    !!metric &&
    allExperimentsWithMetric.length > 0 &&
    !snapshotsData &&
    !snapshotsError;

  const { histogramData, stats, experimentsWithSnapshot } = useMemo(() => {
    const empty = {
      histogramData: [] as HistogramDatapoint[],
      stats: undefined as
        | {
            numExperiments: number;
            numVariations: number;
            mean: number;
            standardDeviation: number;
          }
        | undefined,
      experimentsWithSnapshot: [] as ExperimentWithSnapshot[],
    };

    if (!metric || !snapshotsData?.snapshots?.length) return empty;

    const snapshotsByExperiment = new Map<
      string,
      ExperimentSnapshotInterface
    >();
    snapshotsData.snapshots.forEach((s) => {
      snapshotsByExperiment.set(s.experiment, s);
    });

    const histogramValues: number[] = [];
    const experimentsWithData = new Map<string, ExperimentWithSnapshot>();

    allExperimentsWithMetric.forEach((experiment) => {
      // Apply the user's filter in memory.
      if (!filteredExperimentIds.has(experiment.id)) return;

      const snapshot = snapshotsByExperiment.get(experiment.id);
      if (!snapshot) return;

      const defaultAnalysis = getSnapshotAnalysis(snapshot);
      if (!defaultAnalysis) return;

      const analysis = getSnapshotAnalysis(snapshot, {
        ...defaultAnalysis.settings,
        differenceType,
      });
      if (!analysis) return;

      const result = analysis.results[0];
      if (!result) return;

      result.variations.forEach((variation, variationIndex) => {
        if (variationIndex === 0) return; // Skip baseline

        const variationMetric = variation.metrics[metric];
        if (!variationMetric || variationMetric.errorMessage) return;

        // Exclude no-data variations. A variation can run but produce no usable
        // result (missing/NaN mean, zero users, or a degenerate CI). Backend
        // no-data sentinels (e.g. lift -1 with CI [0, 0]) also land here.
        // Letting them through and coercing a missing mean to 0 produces false
        // spikes at 0 / -1 and inflates the "has data" bookkeeping.
        const mean = variationMetric.uplift?.mean;
        if (mean == null || !isFinite(mean)) return; // no usable point estimate
        if (variationMetric.users === 0) return; // no units observed
        if (
          variationMetric.ci &&
          variationMetric.ci[0] === 0 &&
          variationMetric.ci[1] === 0
        )
          return; // degenerate CI ([0, 0] no-data signature)

        experimentsWithData.set(experiment.id, {
          ...experiment,
          snapshot,
        });

        histogramValues.push(mean);
      });
    });

    if (histogramValues.length === 0) return empty;

    const mean =
      histogramValues.reduce((a, b) => a + b, 0) / histogramValues.length;
    const standardDeviation = Math.sqrt(
      histogramValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
        histogramValues.length,
    );

    return {
      histogramData: createHistogramData(histogramValues),
      stats: {
        numExperiments: experimentsWithData.size,
        numVariations: histogramValues.length,
        mean,
        standardDeviation,
      },
      experimentsWithSnapshot: Array.from(experimentsWithData.values()),
    };
  }, [
    snapshotsData,
    allExperimentsWithMetric,
    filteredExperimentIds,
    metric,
    differenceType,
  ]);

  return (
    <Box className="" width="100%">
      <Box className="appbox appbox-light p-3">
        <Flex direction="row" align="center" justify="between" width="100%">
          <Flex direction="row" gap="4" flexBasis="100%">
            <Box flexBasis="450px" flexGrow="0" flexShrink="1">
              <label htmlFor="metric-selector" className="form-label">
                Metric
              </label>
              <MetricSelector
                value={metric}
                onChange={setMetric}
                project={project}
                includeFacts={true}
                id="metric1-selector"
                style={{ flexBasis: "100%" }}
                sortMetrics={(a, b) => {
                  return (
                    (metricExpCounts[b.id] || 0) - (metricExpCounts[a.id] || 0)
                  );
                }}
                filterMetrics={(m) => !!metricExpCounts[m.id]}
              />
            </Box>
            <Box flexBasis="200px" flexGrow="0" flexShrink="1">
              <SelectField
                size="legacy"
                label="Difference Type"
                value={differenceType}
                onChange={(value) => setDifferenceType(value as DifferenceType)}
                sort={false}
                options={[
                  { label: "Relative", value: "relative" },
                  { label: "Absolute", value: "absolute" },
                  { label: "Scaled Impact", value: "scaled" },
                ]}
              />
            </Box>
          </Flex>
        </Flex>
        {!metric ? (
          <DefaultEmptyState />
        ) : snapshotsError ? (
          <Box mt="4">
            <Callout status="error">
              Error loading experiment results: {snapshotsError.message}
            </Callout>
          </Box>
        ) : snapshotsLoading ? (
          <Flex align="center" justify="center" mt="6" mb="6">
            <LoadingSpinner />
          </Flex>
        ) : metricObj && histogramData.length > 0 ? (
          <Box mt="4" width="100%">
            <Flex direction="column" gap="2" width="100%">
              <Box className="appbox" p="3">
                <Flex
                  direction="row"
                  gap="5"
                  p="3"
                  align="center"
                  justify="center"
                >
                  <Box flexBasis="60%">
                    <HistogramGraph
                      data={histogramData}
                      formatter={(value) =>
                        formatterM1(value, formatterOptions)
                      }
                      xAxisLabel="Lift"
                      mean={stats?.mean || 0}
                      height={300}
                      highlightPositiveNegative={true}
                      invertHighlightColors={metricObj.inverse}
                    />
                  </Box>
                  <Box flexGrow="1" minWidth={"250px"}>
                    <Box className="appbox p-3 bg-light">
                      <Flex direction="column" align="start">
                        <Text as="p" color="gray">
                          <Text weight="medium">
                            Number of Experiments with Results:
                          </Text>{" "}
                          {stats?.numExperiments}
                        </Text>
                        <Text as="p" color="gray">
                          <Text weight="medium">
                            Number of Variations with Results:
                          </Text>{" "}
                          {stats?.numVariations}
                        </Text>
                        <Text as="p" color="gray">
                          <Text weight="medium">Mean:</Text>{" "}
                          {differenceType === "relative"
                            ? formatPercent(stats?.mean || 0)
                            : formatNumber(stats?.mean || 0)}
                        </Text>
                        <Text as="p" color="gray">
                          <Text weight="medium">Standard Deviation:</Text>{" "}
                          {differenceType === "relative"
                            ? formatPercent(stats?.standardDeviation || 0)
                            : formatNumber(stats?.standardDeviation || 0)}
                        </Text>
                      </Flex>
                    </Box>
                  </Box>
                </Flex>
              </Box>
              <Box>
                <MetricExperiments
                  metric={metricObj}
                  dataWithSnapshot={experimentsWithSnapshot}
                  includeOnlyResults={true}
                  numPerPage={10}
                  differenceType={differenceType}
                  outerClassName=""
                />
              </Box>
            </Flex>
          </Box>
        ) : (
          <Box mt="4">
            <Callout status="info">
              No experiments with results found for this metric and the current
              experiment filters.
            </Callout>
          </Box>
        )}
      </Box>
    </Box>
  );
};

const DefaultEmptyState = () => {
  return (
    <Flex gap="4" align="center" justify="between" mt="4">
      <Box px="6" flexBasis="60%" flexShrink="0">
        <Box>
          <Box
            style={{
              border: "1px solid var(--slate-a8)",
              borderTop: 0,
              borderRight: 0,
              width: "100%",
              height: "260px",
              position: "relative",
            }}
          >
            <Box
              style={{
                position: "absolute",
                transform: "rotate(-90deg)",
                color: "var(--slate-a8)",
                left: "-40px",
                top: "50%",
                transformOrigin: "center",
              }}
            >
              Count
            </Box>
          </Box>
          <Box
            p="3"
            style={{
              color: "var(--slate-a8)",
              textAlign: "center",
              transformOrigin: "center",
            }}
          >
            Lift
          </Box>
        </Box>
      </Box>
      <Box flexBasis="40%" style={{ opacity: 0.6 }}>
        <Box className="appbox p-3 bg-light">
          <Flex direction="column" align="start">
            <Text as="p" color="gray">
              <Text weight="medium">Number of Experiments with Results:</Text>{" "}
              --
            </Text>
            <Text as="p" color="gray">
              <Text weight="medium">Number of Variations with Results:</Text> --
            </Text>
            <Text as="p" color="gray">
              <Text weight="medium">Mean:</Text> --
            </Text>
            <Text as="p" color="gray">
              <Text weight="medium">Standard Deviation:</Text> --
            </Text>
          </Flex>
        </Box>
      </Box>
    </Flex>
  );
};

export default MetricEffects;
