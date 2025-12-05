import React, {
  useEffect,
  useCallback,
  useState,
  useMemo,
  ReactNode,
} from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  ExperimentSnapshotInterface,
  ExperimentWithSnapshot,
} from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { Box, Flex, Text } from "@radix-ui/themes";
import { DifferenceType } from "back-end/types/stats";
import { useRouter } from "next/router";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { useExperiments } from "@/hooks/useExperiments";
import MetricSelector from "@/components/Experiment/MetricSelector";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
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
    // Clamp value to the range [minVal, maxVal] for bin assignment
    const clampedValue = Math.max(minVal, Math.min(value, maxVal));

    let binIndex;
    if (clampedValue === maxVal) {
      binIndex = numBins - 1; // Max value goes into the last bin
    } else {
      // Subtract a tiny epsilon to handle floating point inaccuracies for values equal to bin boundaries
      binIndex = Math.floor((clampedValue - minVal - 1e-9) / binSize);
    }

    binIndex = Math.max(0, Math.min(binIndex, numBins - 1));

    if (bins[binIndex]) {
      bins[binIndex].units++;
    }
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
  const { experiments } = useExperiments();
  const router = useRouter();
  const qParams = router.query;

  const params = parseQueryParams(qParams);

  const filteredExperiments = useMemo(
    () => experiments.filter((e) => e.type !== "multi-armed-bandit"),
    [experiments],
  );

  const { hasCommercialFeature } = useUser();
  const hasMetricEffectsCommercialFeature =
    hasCommercialFeature("metric-effects");

  const { theme } = useAppearanceUITheme();
  const computedTheme = theme === "light" ? "light" : "dark";
  const { metrics, factMetrics, datasources } = useDefinitions();

  const metricExpCounts = useMetricExpCounts(filteredExperiments);

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
  } else if (
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
  return (
    <MetricEffectCard
      experiments={filteredExperiments}
      params={params[0] || undefined}
    />
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
  experiments,
  params,
}: {
  experiments: ExperimentInterfaceStringDates[];
  params?: MetricEffectParams;
}): React.ReactElement => {
  const { apiCall } = useAuth();

  const { project, getExperimentMetricById, getFactTableById, metricGroups } =
    useDefinitions();

  const metricExpCounts = useMetricExpCounts(experiments);

  const displayCurrency = useCurrency();

  const [experimentsWithSnapshot, setExperimentsWithSnapshot] = useState<
    ExperimentWithSnapshot[]
  >([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [metric, setMetric] = useState<string>(params?.metric || "");
  const [searchParams, setSearchParams] = useState<Record<string, string>>({});
  const [differenceType, setDifferenceType] = useState<DifferenceType>(
    params?.diff || "relative",
  );
  const [metricData, setMetricData] = useState<{
    histogramData: HistogramDatapoint[];
    stats:
      | {
          numExperiments: number;
          numVariations: number;
          mean: number;
          standardDeviation: number;
        }
      | undefined;
  }>({
    histogramData: [],
    stats: undefined,
  });

  useEffect(() => {
    updateSearchParams(searchParams, false);
  }, [searchParams]);

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

  const handleFetchMetric = useCallback(async () => {
    if (!metric) {
      return;
    }

    setLoading(true);
    const filteredExperiments = filterExperimentsByMetrics(
      experiments,
      metric,
      undefined,
      metricGroups,
    );
    const experimentsWithData = new Map<string, ExperimentWithSnapshot>();

    setSearchParams({
      [`metric_0`]: metric,
      [`diff_0`]: differenceType,
    });

    const queryIds = filteredExperiments
      .map((e) => encodeURIComponent(e.id))
      .join(",");

    try {
      const { snapshots } = await apiCall<{
        snapshots: ExperimentSnapshotInterface[];
      }>(`/experiments/snapshots/?experiments=${queryIds}`, {
        method: "GET",
      });

      setExperimentsWithSnapshot(
        filteredExperiments.map((e) => ({
          ...e,
          snapshot: snapshots.find((s) => s.experiment === e.id) ?? undefined,
        })),
      );

      if (snapshots && snapshots.length > 0) {
        const histogramValues: number[] = [];

        snapshots.forEach((snapshot) => {
          const experiment = filteredExperiments.find(
            (exp) => exp.id === snapshot.experiment,
          );
          if (!experiment) return;

          const defaultAnalysis = getSnapshotAnalysis(snapshot);
          if (!defaultAnalysis) return;

          const analysis = getSnapshotAnalysis(snapshot, {
            ...defaultAnalysis.settings,
            differenceType: differenceType,
          });

          if (!analysis) return;

          const result = analysis.results[0];
          if (!result) return;

          result.variations.forEach((variation, variationIndex) => {
            if (variationIndex === 0) return; // Skip baseline

            const metricData = variation.metrics[metric];

            if (metricData && !metricData.errorMessage) {
              experimentsWithData.set(experiment.id, {
                ...experiment,
                snapshot: snapshot,
              });

              histogramValues.push(metricData.uplift?.mean || 0);
            }
          });
        });
        const metricMean =
          histogramValues.reduce((a, b) => a + b, 0) / histogramValues.length;
        const metricStandardDeviation = Math.sqrt(
          histogramValues.reduce((a, b) => a + Math.pow(b - metricMean, 2), 0) /
            histogramValues.length,
        );
        setMetricData({
          histogramData: createHistogramData(histogramValues),
          stats: {
            numExperiments: experimentsWithData.size,
            numVariations: histogramValues.length,
            mean: metricMean,
            standardDeviation: metricStandardDeviation,
          },
        });
      } else {
        setMetricData({
          histogramData: [],
          stats: undefined,
        });
      }
    } catch (error) {
      console.error(`Error getting snapshots: ${(error as Error).message}`);
      setMetricData({
        histogramData: [],
        stats: undefined,
      });
    } finally {
      setExperimentsWithSnapshot(Array.from(experimentsWithData.values()));
      setLoading(false);
    }
  }, [
    metric,
    experiments,
    differenceType,
    setSearchParams,
    apiCall,
    metricGroups,
  ]);

  useEffect(() => {
    handleFetchMetric();
  }, [handleFetchMetric]);

  return (
    <Box className="" width="100%">
      {/* TODO: add when experiment filter component lands */}
      {/* <Flex align="center" gap="2" className="mb-3" justify="between">
        {experimentFilter ? (
          <>
            <Box flexBasis="40%" flexShrink="1" flexGrow="0">
              <Field
                  placeholder="Search..."
                  type="search"
                  {...searchInputProps}
                />
            </Box>
            <Box>
              <ExperimentSearchFilters
                  experiments={experiments}
                  syntaxFilters={syntaxFilters}
                  searchInputProps={searchInputProps}
                  setSearchValue={setSearchValue}
                />
            </Box>
            <Box>
              <Button
                variant="ghost"
                onClick={() => {
                  setExperimentFilter(false);
                  // TODO remove params
                  //setSearchParams({});
                }}
              >
                Remove All Filters
              </Button>
            </Box>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setExperimentFilter(true)}>
            <BiFilter /> Filter Eligible Experiments
          </Button>
        )}
      </Flex> */}
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
            {loading && (
              <Box>
                <LoadingSpinner />
              </Box>
            )}
          </Flex>
        </Flex>
        {metricObj && metricData.histogramData.length > 0 ? (
          <Box mt="4" width="100%">
            {metricData.histogramData.length > 0 ? (
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
                        data={metricData.histogramData}
                        formatter={(value) =>
                          formatterM1(value, formatterOptions)
                        }
                        xAxisLabel="Lift"
                        mean={metricData.stats?.mean || 0}
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
                            {metricData.stats?.numExperiments}
                          </Text>
                          <Text as="p" color="gray">
                            <Text weight="medium">
                              Number of Variations with Results:
                            </Text>{" "}
                            {metricData.stats?.numVariations}
                          </Text>
                          <Text as="p" color="gray">
                            <Text weight="medium">Mean:</Text>{" "}
                            {differenceType === "relative"
                              ? formatPercent(metricData.stats?.mean || 0)
                              : formatNumber(metricData.stats?.mean || 0)}
                          </Text>
                          <Text as="p" color="gray">
                            <Text weight="medium">Standard Deviation:</Text>{" "}
                            {differenceType === "relative"
                              ? formatPercent(
                                  metricData.stats?.standardDeviation || 0,
                                )
                              : formatNumber(
                                  metricData.stats?.standardDeviation || 0,
                                )}
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
            ) : (
              <Text as="p" color="gray">
                No lift data to display for histogram.
              </Text>
            )}
          </Box>
        ) : metric ? (
          <Box mt="4">
            <Callout status="info">No experiments with results found</Callout>
          </Box>
        ) : (
          <>
            {/* default empty state */}
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
                      <Text weight="medium">
                        Number of Experiments with Results:
                      </Text>{" "}
                      --
                    </Text>
                    <Text as="p" color="gray">
                      <Text weight="medium">
                        Number of Variations with Results:
                      </Text>{" "}
                      --
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
          </>
        )}
      </Box>
    </Box>
  );
};

export default MetricEffects;
