import React, { useEffect, useCallback, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  ExperimentSnapshotInterface,
  ExperimentWithSnapshot,
} from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { DifferenceType } from "back-end/types/stats";
import { FaPlus, FaTrash } from "react-icons/fa";
import { useRouter } from "next/router";
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
import Button from "@/components/Radix/Button";
import {
  filterExperimentsByMetrics,
  updateSearchParams,
} from "@/enterprise/components/Insights/MetricCorrelations";
import HistogramGraph from "@/components/MetricAnalysis/HistogramGraph";
import MetricExperiments from "@/components/MetricExperiments/MetricExperiments";
import { useCurrency } from "@/hooks/useCurrency";

interface HistogramDatapoint {
  start: number;
  end: number;
  units: number;
}

function createHistogramData(
  values: number[],
  numBins: number = 10
): HistogramDatapoint[] {
  if (values.length === 0 || numBins <= 0) return [];

  let minVal = Math.min(...values);
  let maxVal = Math.max(...values);

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

// TODO reparameterize to use across both types of analyses
const parseQueryParams = (
  query: Record<string, string | string[] | undefined>
): MetricEffectParams[] => {
  const params: MetricEffectParams[] = [];
  const paramGroups = new Map<string, MetricEffectParams>();

  // First pass: collect all parameters and group them by their ID
  Object.entries(query).forEach(([key, value]) => {
    if (typeof value !== "string") return;

    const match = key.match(/^(m1|m2|diff)(?:_(.+))?$/);
    if (!match) return;

    const [, paramType, id] = match;
    const idx = Number(id);
    console.log(idx);
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

  const [metricCards, setMetricCards] = useState<number[]>(
    params.length > 0 ? params.map((p) => p.idx) : [0]
  );

  const deleteCard = useCallback(
    (id: number) => {
      setMetricCards(metricCards.filter((cardId) => cardId !== id));
    },
    [metricCards]
  );

  return (
    <Box>
      {metricCards.map((index) => (
        <Box key={index}>
          <MetricEffectCard
            experiments={experiments}
            index={index}
            deleteCard={deleteCard}
            params={params.find((p) => p.idx === index)}
          />
        </Box>
      ))}
      <Button
        variant="ghost"
        mt="4"
        onClick={() => {
          const id = Math.max(...metricCards) + 1;
          setMetricCards([...metricCards, id]);
        }}
      >
        <FaPlus /> Add Another Metric
      </Button>
    </Box>
  );
};

const MetricEffectCard = ({
  experiments,
  index,
  deleteCard,
  params,
}: {
  experiments: ExperimentInterfaceStringDates[];
  index: number;
  deleteCard?: (index: number) => void;
  params?: MetricEffectParams;
}): React.ReactElement => {
  const { apiCall } = useAuth();

  const {
    project,
    getExperimentMetricById,
    getFactTableById,
  } = useDefinitions();

  const displayCurrency = useCurrency();

  const [experimentsWithSnapshot, setExperimentsWithSnapshot] = useState<
    ExperimentWithSnapshot[]
  >([]);
  const [loading, setLoading] = useState<boolean>(false);

  const [metric, setMetric] = useState<string>(params?.metric || "");
  const [searchParams, setSearchParams] = useState<Record<string, string>>({});
  const [differenceType, setDifferenceType] = useState<DifferenceType>(
    params?.diff || "relative"
  );
  const [metricData, setMetricData] = useState<{
    histogramData: HistogramDatapoint[];
    stats:
      | {
          numExperiments: number;
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
    ? formatNumber
    : getExperimentMetricFormatter(
        metricObj,
        getFactTableById,
        differenceType === "absolute" ? "percentagePoints" : "number"
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

    const filteredExperiments = filterExperimentsByMetrics(experiments, metric);

    setSearchParams({
      [`metric_${index}`]: metric,
      [`diff_${index}`]: differenceType,
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

      if (snapshots && snapshots.length > 0) {
        setExperimentsWithSnapshot(
          filteredExperiments.map((e) => ({
            ...e,
            snapshot: snapshots.find((s) => s.experiment === e.id) ?? undefined,
          }))
        );

        const histogramValues: number[] = [];
        let numExperiments = 0;
        const multiplier = differenceType === "relative" ? 100 : 1;

        snapshots.forEach((snapshot) => {
          const experiment = filteredExperiments.find(
            (exp) => exp.id === snapshot.experiment
          );
          if (!experiment) return;

          const defaultAnalysis = getSnapshotAnalysis(snapshot);
          if (!defaultAnalysis) return;

          const analysis = getSnapshotAnalysis(snapshot, {
            ...defaultAnalysis.settings,
            differenceType: differenceType,
          });
          // TODO keep track of experiments missing difference type analysis

          if (!analysis) return;

          const result = analysis.results[0];
          if (!result) return;

          numExperiments++;

          result.variations.forEach((variation, variationIndex) => {
            if (variationIndex === 0) return; // Skip baseline

            const metricData = variation.metrics[metric];

            if (metricData && !metricData.errorMessage) {
              histogramValues.push(multiplier * (metricData.uplift?.mean || 0));
            }
          });
        });
        const metricMean =
          histogramValues.reduce((a, b) => a + b / multiplier, 0) /
          histogramValues.length;
        const metricStandardDeviation = Math.sqrt(
          histogramValues.reduce(
            (a, b) => a + Math.pow(b / multiplier - metricMean, 2),
            0
          ) / histogramValues.length
        );
        setMetricData({
          histogramData: createHistogramData(histogramValues),
          stats: {
            numExperiments: numExperiments,
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
      setLoading(false);
    }
  }, [metric, experiments, differenceType, setSearchParams, index, apiCall]);

  useEffect(() => {
    handleFetchMetric();
  }, [handleFetchMetric]);

  return (
    <Box className="">
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
          {index && deleteCard ? (
            <Button
              variant="ghost"
              onClick={() => {
                deleteCard(index);
                updateSearchParams(searchParams, true);
              }}
            >
              <FaTrash /> Remove
            </Button>
          ) : null}
        </Flex>
        {metricObj && metricData.histogramData.length > 0 ? (
          <Box mt="4">
            <Heading as="h3" size="5" my="3">
              {metricObj.name} - Lift Distribution
            </Heading>
            <Flex
              direction="row"
              justify="center"
              mt="2"
              className="appbox appbox-light"
              align="baseline"
            >
              {metricData.histogramData.length > 0 ? (
                <Flex direction="column" gap="2">
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
                        height={300}
                        highlightPositiveNegative={true}
                        invertHighlightColors={metricObj.inverse}
                      />
                    </Box>
                    <Flex direction="column" align="center">
                      <Text as="p" color="gray">
                        Number of Experiments with Results:{" "}
                        {metricData.stats?.numExperiments}
                      </Text>
                      <Text as="p" color="gray">
                        Mean:{" "}
                        {differenceType === "relative"
                          ? formatPercent(metricData.stats?.mean || 0)
                          : formatNumber(metricData.stats?.mean || 0)}
                      </Text>
                      <Text as="p" color="gray">
                        Standard Deviation:{" "}
                        {differenceType === "relative"
                          ? formatPercent(
                              metricData.stats?.standardDeviation || 0
                            )
                          : formatNumber(
                              metricData.stats?.standardDeviation || 0
                            )}
                      </Text>
                    </Flex>
                  </Flex>
                  <Box p="2">
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
            </Flex>
          </Box>
        ) : metric ? (
          <Box mt="4">
            <Text>No experiments found</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
};

export default MetricEffects;
