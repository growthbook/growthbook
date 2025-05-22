import React, { useEffect, useCallback, useState } from "react";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  ExperimentSnapshotInterface,
  ExperimentWithSnapshot,
} from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { DifferenceType } from "back-end/types/stats";
import ScatterPlotGraph, {
  ScatterPointData,
} from "@/components/ScatterPlotGraph";
import { useExperiments } from "@/hooks/useExperiments";
import MetricSelector from "@/components/Experiment/MetricSelector";
import DatePicker from "@/components/DatePicker";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import HistogramGraph from "@/components/MetricAnalysis/HistogramGraph";
import MetricExperiments from "@/components/MetricExperiments/MetricExperiments";
import {
  formatNumber,
  formatPercent,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import SelectField from "@/components/Forms/SelectField";
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

const filterExperimentsByMetrics = (
  experiments: ExperimentInterfaceStringDates[],
  metric1: string,
  startDate?: string,
  endDate?: string
): ExperimentInterfaceStringDates[] => {
  if (!experiments || experiments.length === 0) {
    return [];
  }
  return experiments.filter((experiment) => {
    const metricIds = getAllMetricIdsFromExperiment(experiment);
    const hasMetric1 = metricIds.includes(metric1);

    let passesDateFilter = true;
    // Date filtering logic
    if (startDate) {
      if (experiment.phases && experiment.phases.length > 0) {
        const latestPhase = experiment.phases[experiment.phases.length - 1];
        if (!latestPhase) {
          passesDateFilter = false;
        } else {
          const experimentStartDate = latestPhase?.dateStarted
            ? new Date(latestPhase.dateStarted)
            : null;
          const experimentEndDate = latestPhase?.dateEnded
            ? new Date(latestPhase.dateEnded)
            : new Date();
          const filterStartDate = new Date(startDate);
          const filterEndDate = endDate
            ? new Date(endDate)
            : new Date("2999-12-31");

          if (experimentStartDate && experimentEndDate) {
            if (
              filterEndDate < experimentStartDate ||
              filterStartDate > experimentEndDate
            ) {
              passesDateFilter = false;
            }
          } else {
            passesDateFilter = false;
          }
        }
      } else {
        passesDateFilter = false;
      }
    }

    if (!passesDateFilter) {
      return false;
    }

    return hasMetric1;
  });
};

const MetricCorrelations = (): React.ReactElement => {
  const { apiCall } = useAuth();

  const { experiments } = useExperiments();
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

  const [metric1, setMetric1] = useState<string>("");
  const [metric2, setMetric2] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [differenceType, setDifferenceType] = useState<DifferenceType>(
    "relative"
  );
  const [metricData, setMetricData] = useState<{
    correlationData: ScatterPointData[];
    histogramDataM1: HistogramDatapoint[];
    histogramDataM2: HistogramDatapoint[];
    statsM1:
      | {
          mean: number;
          standardDeviation: number;
        }
      | undefined;
    statsM2:
      | {
          mean: number;
          standardDeviation: number;
        }
      | undefined;
  }>({
    correlationData: [],
    histogramDataM1: [],
    histogramDataM2: [],
    statsM1: undefined,
    statsM2: undefined,
  });

  const handleFetchCorrelations = useCallback(async () => {
    setLoading(true);

    const filteredExperiments = filterExperimentsByMetrics(
      experiments,
      metric1,
      startDate,
      endDate
    );

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
        const metric1Name = getExperimentMetricById(metric1)?.name || metric1;
        const metric2Name = getExperimentMetricById(metric2)?.name || metric2;

        const newCorrelationData: ScatterPointData[] = [];
        const histogramValuesM1: number[] = [];
        const histogramValuesM2: number[] = [];
        snapshots.forEach((snapshot) => {
          const experiment = filteredExperiments.find(
            (exp) => exp.id === snapshot.experiment
          );
          if (!experiment) return;

          const analysis = getSnapshotAnalysis(snapshot);

          if (!analysis) return;

          const result = analysis.results[0];
          if (!result) return;

          result.variations.forEach((variation, variationIndex) => {
            if (variationIndex === 0) return; // Skip baseline

            const metric1Data = variation.metrics[metric1];
            const metric2Data = variation.metrics[metric2];

            const multiplier = differenceType === "relative" ? 100 : 1;
            const title =
              differenceType === "relative"
                ? "(Lift %)"
                : differenceType === "absolute"
                ? "(Absolute Change)"
                : "(Scaled Impact)";
            if (metric1Data && metric2Data) {
              newCorrelationData.push({
                id: `${experiment.id}_var_${variationIndex}`,
                x: multiplier * (metric1Data.uplift?.mean || 0),
                y: multiplier * (metric2Data.uplift?.mean || 0),
                xmin: multiplier * (metric1Data?.ci?.[0] || 0),
                xmax: multiplier * (metric1Data?.ci?.[1] || 0),
                ymin: multiplier * (metric2Data?.ci?.[0] || 0),
                ymax: multiplier * (metric2Data?.ci?.[1] || 0),
                units: variation.users,
                experimentName: experiment.name || experiment.id,
                variationName:
                  experiment.variations[variationIndex]?.name || "",
                xMetricName: `${metric1Name} ${title}`,
                yMetricName: `${metric2Name} ${title}`,
              });
            }
            if (metric1Data) {
              histogramValuesM1.push(metric1Data.uplift?.mean || 0);
            }
            if (metric2Data) {
              histogramValuesM2.push(metric2Data.uplift?.mean || 0);
            }
          });
        });

        const meanM1 =
          histogramValuesM1.reduce((a, b) => a + b, 0) /
          histogramValuesM1.length;
        const standardDeviationM1 = Math.sqrt(
          histogramValuesM1.reduce((a, b) => Math.pow(b - meanM1, 2), 0) /
            histogramValuesM1.length
        );
        const meanM2 =
          histogramValuesM2.reduce((a, b) => a + b, 0) /
          histogramValuesM2.length;
        const standardDeviationM2 = Math.sqrt(
          histogramValuesM2.reduce((a, b) => Math.pow(b - meanM2, 2), 0) /
            histogramValuesM2.length
        );

        setMetricData({
          correlationData: newCorrelationData,
          histogramDataM1: createHistogramData(histogramValuesM1),
          histogramDataM2: createHistogramData(histogramValuesM2),
          statsM1: {
            mean: meanM1,
            standardDeviation: standardDeviationM1,
          },
          statsM2: {
            mean: meanM2,
            standardDeviation: standardDeviationM2,
          },
        });
      } else {
        setMetricData({
          correlationData: [],
          histogramDataM1: [],
          histogramDataM2: [],
          statsM1: undefined,
          statsM2: undefined,
        });
      }
    } catch (error) {
      console.error(`Error getting snapshots: ${(error as Error).message}`);
      setMetricData({
        correlationData: [],
        histogramDataM1: [],
        histogramDataM2: [],
        statsM1: undefined,
        statsM2: undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [
    metric1,
    metric2,
    startDate,
    endDate,
    experiments,
    differenceType,
    apiCall,
    getExperimentMetricById,
  ]);

  useEffect(() => {
    handleFetchCorrelations();
  }, [handleFetchCorrelations]);

  const metric1Obj = getExperimentMetricById(metric1);
  const metric2Obj = getExperimentMetricById(metric2);

  const formatterM1 = !metric1Obj
    ? formatPercent
    : differenceType === "relative"
    ? formatPercent
    : getExperimentMetricFormatter(
        metric1Obj,
        getFactTableById,
        differenceType === "absolute" ? "percentagePoints" : "number"
      );
  const formatterM2 = !metric2Obj
    ? formatPercent
    : differenceType === "relative"
    ? formatPercent
    : getExperimentMetricFormatter(
        metric2Obj,
        getFactTableById,
        differenceType === "absolute" ? "percentagePoints" : "number"
      );
  const formatterOptions: Intl.NumberFormatOptions = {
    currency: displayCurrency,
    ...(differenceType === "relative" ? { maximumFractionDigits: 1 } : {}),
    ...(differenceType === "scaled" ? { notation: "compact" } : {}),
  };
  return (
    <>
      <Flex direction="row" align="center" justify="between" mb="4">
        <Flex direction="row" gap="2">
          <Box>
            <label htmlFor="metric1-selector" className="form-label">
              Metric
            </label>
            <MetricSelector
              value={metric1}
              onChange={setMetric1}
              project={project}
              includeFacts={true}
              id="metric1-selector"
            />
          </Box>
          <Box>
            <label htmlFor="metric2-selector" className="form-label">
              Metric 2 (optional)
            </label>
            <MetricSelector
              value={metric2}
              onChange={setMetric2}
              project={project}
              includeFacts={true}
              id="metric2-selector"
            />
          </Box>
          <Box>
            <label htmlFor="start-date-selector" className="form-label">
              Experiment Date Range
            </label>
            <DatePicker
              id="start-date-selector"
              date={startDate ? new Date(startDate) : undefined}
              setDate={(d) =>
                setStartDate(d ? d.toISOString().split("T")[0] : "")
              }
              date2={endDate ? new Date(endDate) : undefined}
              setDate2={(d) =>
                setEndDate(d ? d.toISOString().split("T")[0] : "")
              }
              precision="date"
              containerClassName=""
            />
          </Box>
          <Box>
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
        </Flex>
      </Flex>

      {loading && <p>Loading chart data...</p>}
      {!loading && metricData.histogramDataM1.length > 0 && metric1Obj && (
        <Box mt="5">
          <Heading as="h3" size="5" my="3">
            {metric1Obj.name} - Lift Distribution
          </Heading>
          <Flex
            direction="row"
            justify="center"
            mt="2"
            className="appbox appbox-light"
            align="baseline"
          >
            {metricData.histogramDataM1.length > 0 ? (
              <Flex direction="column" gap="2">
                <Flex
                  direction="row"
                  gap="5"
                  p="3"
                  align="center"
                  justify="center"
                >
                  <Box style={{ width: "50%" }}>
                    <HistogramGraph
                      data={metricData.histogramDataM1}
                      formatter={(value) =>
                        formatterM1(value, formatterOptions)
                      }
                      height={300}
                      highlightPositiveNegative={true}
                      invertHighlightColors={metric1Obj.inverse}
                    />
                  </Box>
                  <Flex direction="column" align="center">
                    <Text as="p" color="gray">
                      Mean:{" "}
                      {differenceType === "relative"
                        ? formatPercent(metricData.statsM1?.mean || 0)
                        : formatNumber(metricData.statsM1?.mean || 0)}
                    </Text>
                    <Text as="p" color="gray">
                      Standard Deviation:{" "}
                      {differenceType === "relative"
                        ? formatPercent(
                            metricData.statsM1?.standardDeviation || 0
                          )
                        : formatNumber(
                            metricData.statsM1?.standardDeviation || 0
                          )}
                    </Text>
                  </Flex>
                </Flex>
                <Box p="2">
                  <MetricExperiments
                    metric={metric1Obj}
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
      )}

      {!loading && metricData.histogramDataM2.length > 0 && metric2Obj && (
        <Box mt="5">
          <Heading as="h3" size="5" my="3">
            {metric2Obj.name} - Lift Distribution
          </Heading>
          <Flex
            direction="row"
            justify="center"
            mt="2"
            className="appbox appbox-light"
            align="baseline"
          >
            {metricData.histogramDataM2.length > 0 ? (
              <Flex direction="column" gap="2">
                <Flex
                  direction="row"
                  gap="5"
                  p="3"
                  align="center"
                  justify="center"
                >
                  <Box style={{ width: "50%" }}>
                    <HistogramGraph
                      data={metricData.histogramDataM2}
                      formatter={(value) =>
                        formatterM2(value, formatterOptions)
                      }
                      height={300}
                      highlightPositiveNegative={true}
                      invertHighlightColors={metric2Obj.inverse}
                    />
                  </Box>
                  <Flex direction="column" align="center">
                    <Text as="p" color="gray">
                      Mean:{" "}
                      {differenceType === "relative"
                        ? formatPercent(metricData.statsM2?.mean || 0)
                        : formatNumber(metricData.statsM2?.mean || 0)}
                    </Text>
                    <Text as="p" color="gray">
                      Standard Deviation:{" "}
                      {differenceType === "relative"
                        ? formatPercent(
                            metricData.statsM2?.standardDeviation || 0
                          )
                        : formatNumber(
                            metricData.statsM2?.standardDeviation || 0
                          )}
                    </Text>
                  </Flex>
                </Flex>
                <Box p="2">
                  <MetricExperiments
                    metric={metric2Obj}
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
      )}

      {!loading && metricData.correlationData.length > 0 && (
        <Box mt="5">
          <Heading as="h3" size="5" my="3">
            Correlation of Metric Lift
          </Heading>
          <Flex
            mt="2"
            className="appbox appbox-light"
            align="center"
            justify="center"
            p="3"
          >
            <ScatterPlotGraph
              data={metricData.correlationData}
              width={800}
              height={600}
            />
          </Flex>
        </Box>
      )}
    </>
  );
};

export default MetricCorrelations;
