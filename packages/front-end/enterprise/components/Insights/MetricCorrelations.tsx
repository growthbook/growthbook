import React, { useEffect, useCallback, useState } from "react";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { Box, Flex, Text } from "@radix-ui/themes";
import { DifferenceType } from "back-end/types/stats";
import { FaPlus, FaTrash } from "react-icons/fa";
import router, { useRouter } from "next/router";
import ScatterPlotGraph, {
  ScatterPointData,
} from "@/components/ScatterPlotGraph";
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

export const filterExperimentsByMetrics = (
  experiments: ExperimentInterfaceStringDates[],
  metric1: string,
  metric2?: string
): ExperimentInterfaceStringDates[] => {
  if (!experiments || experiments.length === 0) {
    return [];
  }
  return experiments.filter((experiment) => {
    const metricIds = getAllMetricIdsFromExperiment(experiment);
    const hasMetric1 = metricIds.includes(metric1);
    const hasMetric2 = metric2 ? metricIds.includes(metric2) : true;

    return hasMetric1 && hasMetric2;
  });
};

type MetricCorrelationParams = {
  idx: number;
  m1: string;
  m2: string;
  diff: DifferenceType;
};

const parseQueryParams = (
  query: Record<string, string | string[] | undefined>
): MetricCorrelationParams[] => {
  const params: MetricCorrelationParams[] = [];
  const paramGroups = new Map<string, MetricCorrelationParams>();

  // First pass: collect all parameters and group them by their ID
  Object.entries(query).forEach(([key, value]) => {
    if (typeof value !== "string") return;

    const match = key.match(/^(m1|m2|diff)(?:_(.+))?$/);
    if (!match) return;

    const [, paramType, id] = match;
    const idx = Number(id);
    if (!Number.isInteger(idx)) return;
    const groupId = idx.toString();

    if (!paramGroups.has(groupId)) {
      paramGroups.set(groupId, { idx, m1: "", m2: "", diff: "relative" });
    }

    const group = paramGroups.get(groupId)!;
    if (paramType === "m1") group.m1 = value;
    else if (paramType === "m2") group.m2 = value;
    else if (paramType === "diff") group.diff = value as DifferenceType;
  });

  // Convert groups to array and filter out incomplete groups
  paramGroups.forEach((group) => {
    if (group.m1 && group.m2) {
      params.push(group);
    }
  });

  return params.sort((a, b) => a.idx - b.idx);
};

const MetricCorrelations = (): React.ReactElement => {
  const { experiments } = useExperiments();
  const router = useRouter();
  const qParams = router.query;

  const params = parseQueryParams(qParams);

  const [correlationCards, setCorrelationCards] = useState<number[]>(
    params.length > 0 ? params.map((p) => p.idx) : [0]
  );

  const deleteCard = useCallback(
    (id: number) => {
      setCorrelationCards(correlationCards.filter((cardId) => cardId !== id));
    },
    [correlationCards]
  );

  return (
    <Box>
      {correlationCards.map((index) => (
        <Box key={index}>
          <MetricCorrelationCard
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
          const id = Math.max(...correlationCards) + 1;
          setCorrelationCards([...correlationCards, id]);
        }}
      >
        <FaPlus /> Add New Correlation Analysis
      </Button>
    </Box>
  );
};

export const updateSearchParams = (
  params: Record<string, string>,
  deleteAll: boolean = false
) => {
  const searchParams = new URLSearchParams(window.location.search);

  const shouldDelete = Object.keys(params).length > 0 && deleteAll;
  const shouldSet =
    Object.keys(params).length > 0 &&
    Object.entries(params).some(
      ([key, value]) => searchParams.get(key) !== value
    );
  const shouldUpdateURL = shouldDelete || shouldSet;

  if (shouldDelete) {
    Object.keys(params).forEach((key) => {
      searchParams.delete(key);
    });
  } else if (shouldSet) {
    Object.entries(params).forEach(([key, value]) => {
      searchParams.set(key, value);
    });
  }

  if (shouldUpdateURL) {
    router
      .replace(
        router.pathname +
          (searchParams.size > 0 ? `?${searchParams.toString()}` : "") +
          window.location.hash,
        undefined,
        {
          shallow: true,
        }
      )
      .then();
  }
};

const MetricCorrelationCard = ({
  experiments,
  index,
  deleteCard,
  params,
}: {
  experiments: ExperimentInterfaceStringDates[];
  index: number;
  deleteCard?: (index: number) => void;
  params?: MetricCorrelationParams;
}): React.ReactElement => {
  const { apiCall } = useAuth();

  const {
    project,
    getExperimentMetricById,
    getFactTableById,
  } = useDefinitions();

  //const displayCurrency = useCurrency();

  const [loading, setLoading] = useState<boolean>(false);

  const [metric1, setMetric1] = useState<string>(params?.m1 || "");
  const [metric2, setMetric2] = useState<string>(params?.m2 || "");
  const [searchParams, setSearchParams] = useState<Record<string, string>>({});
  const [differenceType, setDifferenceType] = useState<DifferenceType>(
    params?.diff || "relative"
  );
  const [metricData, setMetricData] = useState<{
    correlationData: ScatterPointData[];
  }>({
    correlationData: [],
  });

  useEffect(() => {
    updateSearchParams(searchParams, false);
  }, [searchParams]);

  const metric1Obj = getExperimentMetricById(metric1);
  const metric2Obj = getExperimentMetricById(metric2);

  const formatterM1 = !metric1Obj
    ? formatPercent
    : differenceType === "relative"
    ? formatNumber
    : getExperimentMetricFormatter(
        metric1Obj,
        getFactTableById,
        differenceType === "absolute" ? "percentagePoints" : "number"
      );
  const formatterM2 = !metric2Obj
    ? formatPercent
    : differenceType === "relative"
    ? formatNumber
    : getExperimentMetricFormatter(
        metric2Obj,
        getFactTableById,
        differenceType === "absolute" ? "percentagePoints" : "number"
      );
  const handleFetchCorrelations = useCallback(async () => {
    if (!metric1 || !metric2) {
      return;
    }

    setLoading(true);

    const filteredExperiments = filterExperimentsByMetrics(
      experiments,
      metric1,
      metric2
    );

    setSearchParams({
      [`m1_${index}`]: metric1,
      [`m2_${index}`]: metric2,
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
        const metric1Name = getExperimentMetricById(metric1)?.name || metric1;
        const metric2Name = getExperimentMetricById(metric2)?.name || metric2;

        const newCorrelationData: ScatterPointData[] = [];
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
          });
        });
        setMetricData({
          correlationData: newCorrelationData,
        });
      } else {
        setMetricData({
          correlationData: [],
        });
      }
    } catch (error) {
      console.error(`Error getting snapshots: ${(error as Error).message}`);
      setMetricData({
        correlationData: [],
      });
    } finally {
      setLoading(false);
    }
  }, [
    metric1,
    metric2,
    experiments,
    differenceType,
    setSearchParams,
    index,
    apiCall,
    getExperimentMetricById,
  ]);

  useEffect(() => {
    handleFetchCorrelations();
  }, [handleFetchCorrelations]);

  return (
    <>
      <Box className="appbox appbox-light p-3">
        <Flex direction="row" align="center" justify="between">
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
                Metric 2
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
        {metricData.correlationData.length > 0 ? (
          <Box mt="4">
            <Flex mt="2" align="center" justify="center" p="3">
              <ScatterPlotGraph
                data={metricData.correlationData}
                width={800}
                height={500}
                xFormatter={formatterM1}
                yFormatter={formatterM2}
              />
            </Flex>
          </Box>
        ) : metric1 && metric2 ? (
          <Box mt="4">
            <Text>No experiments found</Text>
          </Box>
        ) : null}
      </Box>
    </>
  );
};

export default MetricCorrelations;
