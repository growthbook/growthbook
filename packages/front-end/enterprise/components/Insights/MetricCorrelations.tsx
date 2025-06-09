import React, { useEffect, useCallback, useState, useMemo } from "react";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { Box, Flex, Text } from "@radix-ui/themes";
import { DifferenceType } from "back-end/types/stats";
import router, { useRouter } from "next/router";
import Callout from "@/components/Radix/Callout";
import ScatterPlotGraph, {
  ScatterPointData,
} from "@/components/ScatterPlotGraph";
import { useExperiments } from "@/hooks/useExperiments";
import MetricSelector from "@/components/Experiment/MetricSelector";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import {
  formatPercent,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useUser } from "@/services/UserContext";
import PremiumEmptyState from "@/components/PremiumEmptyState";

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

type MetricCorrelationTooltipData = {
  experimentName: string;
  variationName: string;
  xMetricName: string;
  yMetricName: string;
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

  const filteredExperiments = useMemo(
    () => experiments.filter((e) => e.type !== "multi-armed-bandit"),
    [experiments]
  );

  const { hasCommercialFeature } = useUser();
  const hasMetricCorrelationCommercialFeature = hasCommercialFeature(
    "metric-correlations"
  );

  if (!hasMetricCorrelationCommercialFeature) {
    return (
      <Box mb="3">
        <PremiumEmptyState
          title="Examine relationships between metrics"
          description="Explore how metrics are related across experiments."
          commercialFeature="metric-correlations"
          learnMoreLink="https://docs.growthbook.io/app/metrics" //<- fix this link when docs are ready
          image="/images/empty-states/metric_correlations.png"
        />
      </Box>
    );
  }
  return (
    <MetricCorrelationCard
      experiments={filteredExperiments}
      params={params[0]}
    />
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
  params,
}: {
  experiments: ExperimentInterfaceStringDates[];
  params?: MetricCorrelationParams;
}): React.ReactElement => {
  const { apiCall } = useAuth();

  const {
    project,
    getExperimentMetricById,
    getFactTableById,
    metricGroups,
  } = useDefinitions();

  //const displayCurrency = useCurrency();

  const [loading, setLoading] = useState<boolean>(false);

  const [metric1, setMetric1] = useState<string>(params?.m1 || "");
  const [metric2, setMetric2] = useState<string>(params?.m2 || "");
  const [metric1Name, setMetric1Name] = useState<string>("");
  const [metric2Name, setMetric2Name] = useState<string>("");
  const [searchParams, setSearchParams] = useState<Record<string, string>>({});
  const [differenceType, setDifferenceType] = useState<DifferenceType>(
    params?.diff || "relative"
  );
  const [metricData, setMetricData] = useState<{
    correlationData: ScatterPointData<MetricCorrelationTooltipData>[];
  }>({
    correlationData: [],
  });

  const metric1OptionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    experiments.forEach((experiment) => {
      const metricIds = getAllMetricIdsFromExperiment(
        experiment,
        false,
        metricGroups
      );
      metricIds.forEach((metricId) => {
        counts[metricId] = (counts[metricId] || 0) + 1;
      });
    });
    return counts;
  }, [experiments, metricGroups]);

  const metric2OptionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!metric1) return counts;

    experiments.forEach((exp) => {
      const ids = getAllMetricIdsFromExperiment(exp, false, metricGroups);
      if (!ids.includes(metric1)) return;
      ids.forEach((id) => {
        if (id === metric1) return;
        counts[id] = (counts[id] || 0) + 1;
      });
    });
    return counts;
  }, [experiments, metricGroups, metric1]);

  useEffect(() => {
    updateSearchParams(searchParams, false);
  }, [searchParams]);

  const metric1Obj = getExperimentMetricById(metric1);
  const metric2Obj = getExperimentMetricById(metric2);

  useEffect(() => {
    const title =
      differenceType === "relative"
        ? "(Lift %)"
        : differenceType === "absolute"
        ? "(Absolute Change)"
        : "(Scaled Impact)";

    if (metric1Obj) {
      setMetric1Name(`${metric1Obj.name} ${title}`);
    }
    if (metric2Obj) {
      setMetric2Name(`${metric2Obj.name} ${title}`);
    }
  }, [metric1Obj, metric2Obj, differenceType]);

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
      [`m1_0`]: metric1,
      [`m2_0`]: metric2,
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

      if (snapshots && snapshots.length > 0) {
        const newCorrelationData: ScatterPointData<MetricCorrelationTooltipData>[] = [];
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

            if (metric1Data?.errorMessage || metric2Data?.errorMessage) {
              return;
            }

            if (metric1Data && metric2Data) {
              newCorrelationData.push({
                id: `${experiment.id}_var_${variationIndex}`,
                x: metric1Data.uplift?.mean || 0,
                y: metric2Data.uplift?.mean || 0,
                xmin: metric1Data?.ci?.[0] || 0,
                xmax: metric1Data?.ci?.[1] || 0,
                ymin: metric2Data?.ci?.[0] || 0,
                ymax: metric2Data?.ci?.[1] || 0,
                units: variation.users,
                otherData: {
                  experimentName: experiment.name || experiment.id,
                  variationName:
                    experiment.variations[variationIndex]?.name || "",
                  xMetricName: metric1Name,
                  yMetricName: metric2Name,
                },
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
    metric1Name,
    metric2Name,
    experiments,
    differenceType,
    setSearchParams,
    apiCall,
  ]);

  useEffect(() => {
    handleFetchCorrelations();
  }, [handleFetchCorrelations]);

  return (
    <>
      <Box className="appbox appbox-light p-3">
        <Flex direction="row" align="center" justify="between">
          <Flex direction="row" gap="4" flexBasis="100%">
            <Box flexBasis="400px" flexGrow="0" flexShrink="1">
              <label htmlFor="metric1-selector" className="form-label">
                Metric 1
              </label>
              <MetricSelector
                value={metric1}
                onChange={(id) => {
                  setMetric1(id);
                  setMetric2(""); // Reset metric2 when metric1 changes
                }}
                project={project}
                includeFacts={true}
                id="metric1-selector"
                filterMetrics={(m) => !!metric1OptionCounts[m.id]}
                sortMetrics={(a, b) => {
                  return (
                    (metric1OptionCounts[b.id] || 0) -
                    (metric1OptionCounts[a.id] || 0)
                  );
                }}
              />
            </Box>
            <Box flexBasis="400px" flexGrow="0" flexShrink="1">
              <label htmlFor="metric2-selector" className="form-label">
                Metric 2
              </label>
              <MetricSelector
                value={metric2}
                onChange={setMetric2}
                project={project}
                includeFacts={true}
                id="metric2-selector"
                disabled={!metric1}
                filterMetrics={(m) => !!metric2OptionCounts[m.id]}
                sortMetrics={(a, b) => {
                  return (
                    (metric2OptionCounts[b.id] || 0) -
                    (metric2OptionCounts[a.id] || 0)
                  );
                }}
                initialOption="Select..."
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
        {!metric1 || !metric2 || loading ? null : metricData.correlationData
            .length > 0 ? (
          <Box mt="4">
            <Flex mt="2" align="center" justify="center" p="3">
              <ScatterPlotGraph
                data={metricData.correlationData}
                width={800}
                height={500}
                xFormatter={formatterM1}
                yFormatter={formatterM2}
                xLabel={metric1Name}
                yLabel={metric2Name}
                generateTooltipContent={(data) => (
                  <Flex direction="column" gap="2">
                    <Flex justify="between" gapX="2">
                      <Text weight="bold">Experiment:</Text>
                      <Text>{data.otherData.experimentName}</Text>
                    </Flex>
                    <Flex justify="between" gapX="2">
                      <Text weight="bold">Variation:</Text>
                      <Text>{data.otherData.variationName}</Text>
                    </Flex>
                    <Flex justify="between" gapX="2">
                      <Text weight="bold">{data.otherData.xMetricName}</Text>
                      <Text>
                        {formatterM1(data.x)} ({formatterM1(data.xmin)} -{" "}
                        {formatterM1(data.xmax)})
                      </Text>
                    </Flex>
                    <Flex justify="between" gapX="2">
                      <Text weight="bold">{data.otherData.yMetricName}</Text>
                      <Text>
                        {formatterM2(data.y)} ({formatterM2(data.ymin)} -{" "}
                        {formatterM2(data.ymax)})
                      </Text>
                    </Flex>
                    <Flex justify="between" gapX="2">
                      <Text weight="bold">Units:</Text>
                      <Text>{data.units.toLocaleString()}</Text>
                    </Flex>
                  </Flex>
                )}
              />
            </Flex>
          </Box>
        ) : (
          <Box mt="4">
            <Callout status="info">
              No experiments found that both have these two metrics
            </Callout>
          </Box>
        )}
      </Box>
    </>
  );
};

export default MetricCorrelations;
