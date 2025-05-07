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
  const table: TwoAxisTableProps = {
    axis1: {
      id: "experiment1",
      name: <Text>{experiment1.name}</Text>,
      values: experiment1.variations.map((v, i) => ({
        id: v.id,
        value: variationName(i, v.name),
        overallCellValue: <Text>{v.name}</Text>,
        sortOrder: i,
      })),
      sortOrder: 0,
    },
    axis2: {
      id: "experiment2",
      name: <Text>{experiment2.name}</Text>,
      values: experiment2.variations.map((v, i) => {
        const mainAnalysis2Variations = mainAnalysis2?.results?.[0];
        let overallCellValue: JSX.Element | undefined = undefined;
        if (mainAnalysis2Variations) {
          console.log(mainAnalysis2Variations);
          mainAnalysis2Variations.variations.forEach(
            (v) => {
              const metricResults = v.metrics[metric.id];
              const baseline = mainAnalysis2Variations.variations[0].metrics[metric.id];
              if (!metricResults || !baseline) return;
              const resultsStatus = getMetricResultStatus({
                metric,
                metricDefaults,
                baseline,
                stats: metricResults,
                ciLower,
                ciUpper,
                pValueThreshold,
                statsEngine,
              });
              const value =
                statistic === "expected" ? metricResults.expected : metricResults.cr;
              const formatter =
                statistic === "expected"
                  ? formatPercent
                  : getExperimentMetricFormatter(metric, getFactTableById, "percentage");
              if (value) {
                overallCellValue = <Flex direction={"column"}>
                  <Text>{formatter(value)}</Text>
                  <Text className="text-muted small-units-text">
                    {metricResults.users} units
                  </Text>
                </Flex>
              }
            }
          )
        }
        return {
        id: v.id,
        value: variationName(i, v.name),
        overallCellValue,
        sortOrder: i,
      }}),
      sortOrder: 1,
    },
    data: [],
  };

  const mainAnalysis = analysis.results?.[0];
  if (mainAnalysis) {
    mainAnalysis.variations.forEach((v, i) => {
      const metricResults = v.metrics[metric.id];
      const baseline = mainAnalysis.variations[0].metrics[metric.id];
      if (!metricResults) return;

      const variation = variations[i];
      if (!variation) return;

      // extract component of variation string that is before
      // the separator of ___GBINTERACTION___
      const exp1VariationKey = variation.split("___GBINTERACTION___")[0];
      const exp2VariationKey = variation.split("___GBINTERACTION___")[1];

      const exp1Variation = experiment1.variations.find(
        (v) => v.key === exp1VariationKey
      );
      const exp2Variation = experiment2.variations.find(
        (v) => v.key === exp2VariationKey
      );

      // significance logic
      const resultsStatus = getMetricResultStatus({
        metric,
        metricDefaults,
        baseline,
        stats: metricResults,
        ciLower,
        ciUpper,
        pValueThreshold,
        statsEngine,
      });
      const differenceType = "relative";
      const value =
        statistic === "expected" ? metricResults.expected : metricResults.cr;
      const formatter =
        statistic === "expected"
          ? formatPercent
          : getExperimentMetricFormatter(metric, getFactTableById, "percentage");
      table.data.push({
        id: `${i}`,
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
  const [desiredStatistic, setDesiredStatistic] = useState<
    "expected" | "variationMean"
  >("expected");
  const { data, error, isValidating, mutate } = useApi<{
    snapshot: InteractionSnapshotInterface;
  }>(`/experiment/${experiment1?.id}/experiment/${experiment2?.id}`, {
    shouldRun: () => !!experiment1 && !!experiment2,
  });
  console.log(data);

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
      size="lg"
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

        <Flex gap="4" className="mb-6">
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
        </Flex>

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
        />

        {interactionData && (
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
        )}
        {tableData && (
          <Box className="mt-6">
            <Text size="3" weight="bold" className="mb-4">
              Interaction Results
            </Text>
            <TwoAxisTable {...tableData} />
          </Box>
        )}
      </Box>
    </Modal>
  );
}
