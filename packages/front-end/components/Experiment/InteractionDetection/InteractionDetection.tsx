import React, { useEffect, useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import {
  ExperimentMetricInterface,
  getMetricResultStatus,
} from "shared/experiments";
import { MetricDefaults } from "back-end/types/organization";
import { StatsEngine } from "back-end/types/stats";
import clsx from "clsx";
import { FactTableInterface } from "back-end/types/fact-table";
import { useDefinitions } from "@/services/DefinitionsContext";
import TwoAxisTable, {
  TwoAxisTableProps,
} from "@/components/TwoAxisTable/TwoAxisTable";
import SelectField from "@/components/Forms/SelectField";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { useExperiments } from "@/hooks/useExperiments";
import Modal from "@/components/Modal";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import {
  formatPercent,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import { InteractionSnapshotAnalysis, InteractionSnapshotInterface } from "back-end/types/interaction-snapshot";
import VennDiagram, { Segment } from "@/components/VennDiagram/VennDiagram";

// Define a list of colors for the segments
const SEGMENT_COLORS = ["#8884d8", "#82ca9d", "#ffc658", "#ff8042", "#0088FE", "#00C49F"];

function getVariationData({
  statistic,
  analysis,
  mainAnalysis1,
  mainAnalysis2,
  variations,
  metric,
  metricDefaults,
  ciLower,
  ciUpper,
  pValueThreshold,
  statsEngine,
  experiment1,
  experiment2,
  getFactTableById,
}: {
  statistic: "expected" | "variationMean";
  analysis: InteractionSnapshotAnalysis;
  mainAnalysis1?: ExperimentSnapshotAnalysis;
  mainAnalysis2?: ExperimentSnapshotAnalysis;
  variations: string[];
  metric: ExperimentMetricInterface;
  metricDefaults: MetricDefaults;
  ciLower: number;
  ciUpper: number;
  pValueThreshold: number;
  statsEngine: StatsEngine;
  experiment1: ExperimentInterfaceStringDates;
  experiment2: ExperimentInterfaceStringDates;
  getFactTableById: (id: string) => FactTableInterface | null;
}) {
  const variationName = (variationIndex: number, variationName: string) => {
    // left align rows and shrink col width
    return (
      <div
        className={`variation variation${variationIndex} with-variation-label d-flex align-items-center justify-content-center`}
      >
        <span className="label" style={{ width: 20, height: 20 }}>
          {variationIndex}
        </span>
        <span
          className="d-inline-block text-ellipsis hover"
          style={{
            maxWidth: 150,
          }}
        >
          {variationName}
        </span>
      </div>
    );
  };

  // Helper function to generate overall cell values for an axis
  const generateAxisOverallCellValues = (
    currentMainAnalysis: ExperimentSnapshotAnalysis | undefined,
    statsEngineForThisAnalysis: StatsEngine
  ): (JSX.Element | undefined)[] => {
    const analysisVariations = currentMainAnalysis?.results?.[0]?.variations;
    if (!analysisVariations) {
      return []; // Return empty array if no data, caller should handle missing indices
    }

    const baselineMetricData = analysisVariations[0]?.metrics[metric.id];

    return analysisVariations.map((analysisVariationData, index) => {
      const metricResults = analysisVariationData.metrics[metric.id];

      if (!metricResults || !baselineMetricData) {
        return undefined;
      }

      const resultsStatus = getMetricResultStatus({
        metric,
        metricDefaults,
        baseline: baselineMetricData,
        stats: metricResults,
        ciLower,
        ciUpper,
        pValueThreshold,
        statsEngine: statsEngineForThisAnalysis, // Use the specific stats engine for this main analysis
      });
      const value =
        statistic === "expected" ? metricResults.expected : metricResults.cr;
      const formatter =
        statistic === "expected"
          ? formatPercent
          : getExperimentMetricFormatter(metric, getFactTableById, "percentage");

      if (value !== undefined || index === 0) {
        return (
          <Flex direction={"column"}>
            <Text
              className={clsx("results-change", {
                [resultsStatus.directionalStatus]:
                  resultsStatus.significant && metricResults.expected !== undefined,
              })}
            >
              {index === 0 && statistic === "expected" || value === undefined
                ? formatter(0)
                : formatter(value)}
            </Text>
            <Text className="text-muted small-units-text">
              {metricResults.users} units
            </Text>
          </Flex>
        );
      }
      return undefined;
    });
  };

  // Helper function to generate data cells for the table body
  const generateTableDataCells = (
    jointAnalysisResults: InteractionSnapshotAnalysis['results'],
    interactionVariationNames: string[]
  ): TwoAxisTableProps['data'] => {
    const cells: TwoAxisTableProps['data'] = [];
    const jointMainAnalysisDimension = jointAnalysisResults?.[0];

    if (jointMainAnalysisDimension && jointMainAnalysisDimension.variations) {
      const baselineMetricData = jointMainAnalysisDimension.variations[0]?.metrics[metric.id];

      jointMainAnalysisDimension.variations.forEach((analysisVariationData, index) => {
        const metricResults = analysisVariationData.metrics[metric.id];
        if (!metricResults || !baselineMetricData) return;

        const interactionVariationName = interactionVariationNames[index];
        if (!interactionVariationName) return;

        const exp1VariationKey = interactionVariationName.split("___GBINTERACTION___")[0];
        const exp2VariationKey = interactionVariationName.split("___GBINTERACTION___")[1];

        const exp1Variation = experiment1.variations.find(
          (vExp) => vExp.key === exp1VariationKey
        );
        const exp2Variation = experiment2.variations.find(
          (vExp) => vExp.key === exp2VariationKey
        );

        const resultsStatus = getMetricResultStatus({
          metric,
          metricDefaults,
          baseline: baselineMetricData,
          stats: metricResults,
          ciLower,
          ciUpper,
          pValueThreshold,
          statsEngine, // Use the joint statsEngine passed to getVariationData
        });
        const value =
          statistic === "expected" ? metricResults.expected : metricResults.cr;
        const formatter =
          statistic === "expected"
            ? formatPercent
            : getExperimentMetricFormatter(metric, getFactTableById, "percentage");

        cells.push({
          id: `${index}`,
          rowAxisValueId: exp1Variation?.id ?? "",
          columnAxisValueId: exp2Variation?.id ?? "",
          value: (
            <Flex direction={"column"}>
              {value !== undefined ? (
                <Text>{formatter(value)}</Text>
              ) : (
                <Text>0%</Text>
              )}
              <Text className="text-muted small-units-text">
                {metricResults.users} units
              </Text>
            </Flex>
          ),
          className: clsx("results-change", {
            [resultsStatus.directionalStatus]:
              resultsStatus.significant && metricResults.expected !== undefined,
          }),
        });
      });
    }
    return cells;
  };

  const overallCellValues1 = generateAxisOverallCellValues(
    mainAnalysis1,
    statsEngine // Fallback to joint if specific not found
  );
  const overallCellValues2 = generateAxisOverallCellValues(
    mainAnalysis2,
    statsEngine // Fallback to joint if specific not found
  );

  const table: TwoAxisTableProps = {
    axis1: {
      id: "experiment1",
      name: <Text>{experiment1.name}</Text>,
      values: experiment1.variations.map((v, i) => ({
        id: v.id,
        value: variationName(i, v.name),
        overallCellValue: overallCellValues1[i],
        sortOrder: i,
      })),
      sortOrder: 0,
    },
    axis2: {
      id: "experiment2",
      name: <Text>{experiment2.name}</Text>,
      values: experiment2.variations.map((v, i) => ({
        id: v.id,
        value: variationName(i, v.name),
        overallCellValue: overallCellValues2[i],
        sortOrder: i,
      })),
      sortOrder: 1,
    },
    data: generateTableDataCells(analysis.results, variations),
  };

  return table;
}

// TODO add overall row
type ExperimentWithPhaseDates = ExperimentInterfaceStringDates & {
  phaseDateStarted: string;
  phaseDateEnded: string | undefined;
};

export default function InteractionDetection() {
  const { apiCall } = useAuth();

  const { experiments } = useExperiments();
  const { metricDefaults } = useOrganizationMetricDefaults();
  const { ciUpper, ciLower } = useConfidenceLevels();
  const pValueThreshold = usePValueThreshold();
  const { getExperimentMetricById, getFactTableById } = useDefinitions();
  const [
    experiment1,
    setExperiment1,
  ] = useState<ExperimentWithPhaseDates | null>(null);
  const [
    experiment2,
    setExperiment2,
  ] = useState<ExperimentWithPhaseDates | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [
    interactionData,
    setInteractionData,
  ] = useState<InteractionSnapshotInterface | null>(null);
  const [metricId, setMetricId] = useState<string>("");
  const [tableData, setTableData] = useState<TwoAxisTableProps | null>(null);
  const [
    barChartData,
    setBarChartData,
  ] = useState<Segment[] | null>(null);
  const [desiredStatistic, setDesiredStatistic] = useState<
    "expected" | "variationMean"
  >("expected");
  const { data, error, isValidating, mutate } = useApi<{
    snapshot: InteractionSnapshotInterface;
  }>(`/experiment/${experiment1?.id}/experiment/${experiment2?.id}`, {
    shouldRun: () => !!experiment1 && !!experiment2,
  });

  // overlap in phase dates
  const experimentOptions: ExperimentWithPhaseDates[] = experiments
    .map((e) => ({
      ...e,
      phaseDateStarted: e.phases[e.phases.length - 1]?.dateStarted,
      phaseDateEnded: e.phases[e.phases.length - 1]?.dateEnded,
    }))
    .filter(
      (e): e is ExperimentWithPhaseDates =>
        !e.archived && e.status !== "draft" && e.phaseDateStarted !== undefined
    );

  useEffect(() => {
    if (data) {
      setInteractionData(data.snapshot);
    }
  }, [data]);

  useEffect(() => {
    if (experiment1 && experiment2 && interactionData && interactionData.jointAnalyses?.[0]?.results?.[0]) {
      const analysis = interactionData.jointAnalyses[0];
      const values: Segment[] = [
        { label: "Both", value: 0, color: SEGMENT_COLORS[0] },
        { label: `${experiment1.name} only`, value: 0, color: SEGMENT_COLORS[1] },
        { label: `${experiment2.name} only`, value: 0, color: SEGMENT_COLORS[2] }
      ];
      if (analysis?.results?.[0]?.variations) {
        analysis.results[0].variations.forEach((_, index) => {
          const analysisVariationData = analysis.results[0].variations[index];
          const exp1VariationKey = interactionData.config.variationNames[index].split("___GBINTERACTION___")[0];
          const exp2VariationKey = interactionData.config.variationNames[index].split("___GBINTERACTION___")[1];
          
          if (exp1VariationKey === "__GBNULLVARIATION__" || exp1VariationKey === "__multiple__") {
            values[2].value += analysisVariationData?.users ?? 0;
          } else if (exp2VariationKey === "__GBNULLVARIATION__" || exp2VariationKey === "__multiple__") {
            values[1].value += analysisVariationData?.users ?? 0;
          } else {
            values[0].value += analysisVariationData?.users ?? 0;
          }
        });
        setBarChartData(values);
      } else {
        setBarChartData(null);
      }
    } else {
      setBarChartData(null);
    }
  }, [experiment1, experiment2, interactionData]);

  const handleAnalyze = async () => {
    if (!experiment1 || !experiment2) return;

    setIsLoading(true);
    try {
      const response = await apiCall<InteractionSnapshotInterface>(
        "/experiments/interaction",
        {
          method: "POST",
          body: JSON.stringify({
            experiment1Id: experiment1.id,
            experiment2Id: experiment2.id,
          }),
        }
      );
      mutate();
      console.log(response);
    } catch (e) {
      console.error("Failed to analyze interaction:", e);
    }
    setIsLoading(false);
  };

  // validate compatibility of experiments
  useEffect(() => {
    if (!interactionData) return;
    if (!experiment1 || !experiment2) return;
    const metric = getExperimentMetricById(metricId);
    if (!metric) return;
    const tableData = getVariationData({
      statistic: desiredStatistic,
      analysis: interactionData.jointAnalyses[0],
      mainAnalysis1: interactionData.mainAnalyses[0],
      mainAnalysis2: interactionData.mainAnalyses[1],
      variations: interactionData.config.variationNames,
      metric,
      metricDefaults,
      ciLower,
      ciUpper,
      pValueThreshold,
      statsEngine: interactionData.jointAnalyses[0]?.settings.statsEngine,
      experiment1: experiment1,
      experiment2: experiment2,
      getFactTableById,
    });
    setTableData(tableData);
  }, [experiment1, experiment2, metricId, interactionData, desiredStatistic]);

  return (
    <Modal
      size="max"
      open={true}
      close={() => {}}
      trackingEventModalType="experiment-interaction-analysis"
    >
      <Box className="p-4">
        <Flex direction="column" gap="1">
          <Text size="4" weight="bold">
            Experiment Interaction Analysis
          </Text>

          <Text size="2" className="mb-4">
            Estimate the joint impact of two experiments on key metrics. Only
            experiments that were concurrent can be jointly analyzed.
          </Text>
        </Flex>

        <Flex gap="4" className="mb-6" align="center">
          <Box className="flex-1">
            <SelectField
              label="Experiment 1"
              value={experiment1?.id ?? ""}
              onChange={(v) => {
                setExperiment1(
                  experimentOptions.find((e) => e.id === v) ?? null
                );
              }}
              options={experimentOptions.map((e) => ({
                value: e.id,
                label: e.name,
              }))}
            />
          </Box>
          <Box className="flex-1">
            <SelectField
              label="Experiment 2"
              value={experiment2?.id ?? ""}
              disabled={!experiment1}
              onChange={(v) => {
                setExperiment2(
                  experimentOptions.find((e) => e.id === v) ?? null
                );
              }}
              options={experimentOptions
                .filter(
                  (e) =>
                    experiment1 &&
                    e.id !== experiment1.id && // experiment started while other experiment was running
                    ((e.phaseDateStarted >= experiment1.phaseDateStarted &&
                      (!experiment1.phaseDateEnded ||
                        e.phaseDateStarted <= experiment1.phaseDateEnded)) ||
                      // experiment ended while other experiment was running
                      (e.phaseDateEnded &&
                        e.phaseDateEnded >= experiment1.phaseDateStarted &&
                        e.phaseDateStarted <= experiment1.phaseDateStarted))
                )
                .map((exp) => ({
                  value: exp.id,
                  label: exp.name,
                }))}
            />
          </Box>

        <div className="col-auto">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              handleAnalyze();
            }}
          >
            <RunQueriesButton
              cta={"Run Analysis"}
              cancelEndpoint={`TODO`}
              mutate={mutate}
              model={
                data?.snapshot ?? {
                  queries: [],
                  runStarted: new Date(),
                }
              }
              icon="refresh"
            />
          </form>
        </div>


        <ViewAsyncQueriesButton
          queries={data?.snapshot?.queries.map((q) => q.query) ?? []}
          error={data?.snapshot?.error}
          condensed={true}
          status={undefined}
          display={null}
        />
        </Flex>

        {interactionData && interactionData?.status === "success" && (
        <Flex gap="4" direction="column">
        
          <Box className="mt-6">
            <Text size="3" weight="bold" className="mb-4">
              Interaction Results
            </Text>
          </Box>
          
          {barChartData && (<Box className="appbox appbox-light p-2"><Text size="3" weight="bold" className="mb-4">
              Unit overlap
            </Text>
            <VennDiagram
              data={barChartData}
              formatter={(value) => value.toLocaleString()}
              height={250}
            />
            </Box>)}
            <Box className="appbox appbox-light p-2">
            <Text size="3" weight="bold" className="mb-4">
              Metric Impact
            </Text>
            <Flex direction="row" gap="4" mt="6">
           
            <Box>
            
              {/* TODO: fix metric selection */}
              <SelectField
                label="Metric"
                value={metricId}
                onChange={(e) => setMetricId(e)}
                options={interactionData.config.metricSettings.map((m) => ({
                  value: m.id,
                  label: getExperimentMetricById(m.id)?.name ?? m.id,
                }))}
              />
            </Box>
            <Box>
              <SelectField
                label="Statistic"
                value={desiredStatistic}
                onChange={(e) =>
                  setDesiredStatistic(e as "expected" | "variationMean")
                }
                options={[
                  { value: "expected", label: "Lift" },
                  { value: "variationMean", label: "Variation Means" },
                ]}
              />
            </Box>
          </Flex>
          {tableData &&  <Box className="mt-6">
            <TwoAxisTable {...tableData} />
          </Box>}
          </Box>
          </Flex>
        )}
      </Box>
    </Modal>
  );
}
