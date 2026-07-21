import React, { useEffect, useCallback, useState, useMemo } from "react";
import {
  ExperimentMetricDefinition,
  getAllMetricIdsFromExperiment,
  getLatestPhaseVariations,
} from "shared/experiments";
import { MetricGroupInterface } from "shared/types/metric-groups";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  ExperimentSnapshotInterface,
  ExperimentWithSnapshot,
} from "shared/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { Box, Flex, Text } from "@radix-ui/themes";
import { DifferenceType } from "shared/types/stats";
import router, { useRouter } from "next/router";
import Callout from "@/ui/Callout";
import ScatterPlotGraph, {
  ScatterPointData,
} from "@/components/ScatterPlotGraph";
import { useExperiments } from "@/hooks/useExperiments";
import MetricSelector from "@/components/Experiment/MetricSelector";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  formatPercent,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useUser } from "@/services/UserContext";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import EmptyState from "@/components/EmptyState";
import LinkButton from "@/ui/LinkButton";
import MetricCorrelationsExperimentTable from "@/enterprise/components/Insights/MetricCorrelations/MetricCorrelationsExperimentTable";
import { useCurrency } from "@/hooks/useCurrency";
import useApi from "@/hooks/useApi";
import { useExperimentSearch } from "@/services/experiments";
import ExperimentSearchFilters from "@/components/Search/ExperimentSearchFilters";
import Field from "@/components/Forms/Field";
import Link from "@/ui/Link";
import LoadingOverlay from "@/components/LoadingOverlay";

export const filterExperimentsByMetrics = (
  experiments: ExperimentInterfaceStringDates[],
  metric1: string,
  metric2?: string,
  metricGroups: MetricGroupInterface[] = [],
): ExperimentInterfaceStringDates[] => {
  if (!experiments || experiments.length === 0) {
    return [];
  }
  return experiments.filter((experiment) => {
    const metricIds = getAllMetricIdsFromExperiment(
      experiment,
      false,
      metricGroups,
    );
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
  excludedExperimentVariations: {
    experimentId: string;
    variationIndex: number;
  }[];
};

type MetricCorrelationTooltipData = {
  experimentName: string;
  variationName: string;
  xMetricName: string;
  yMetricName: string;
};

const parseQueryParams = (
  query: Record<string, string | string[] | undefined>,
): MetricCorrelationParams[] => {
  const params: MetricCorrelationParams[] = [];
  const paramGroups = new Map<string, MetricCorrelationParams>();

  // First pass: collect all parameters and group them by their ID
  Object.entries(query).forEach(([key, value]) => {
    if (typeof value !== "string") return;

    const match = key.match(
      /^(m1|m2|diff|excludedExperimentVariations)(?:_(.+))?$/,
    );
    if (!match) return;

    const [, paramType, id] = match;
    const idx = Number(id);
    if (!Number.isInteger(idx)) return;
    const groupId = idx.toString();

    if (!paramGroups.has(groupId)) {
      paramGroups.set(groupId, {
        idx,
        m1: "",
        m2: "",
        diff: "relative",
        excludedExperimentVariations: [],
      });
    }

    const group = paramGroups.get(groupId)!;
    if (paramType === "m1") group.m1 = value;
    else if (paramType === "m2") group.m2 = value;
    else if (paramType === "diff") group.diff = value as DifferenceType;
    else if (paramType === "excludedExperimentVariations") {
      const evs = value.split(",");
      const excludedExperimentVariations: {
        experimentId: string;
        variationIndex: number;
      }[] = [];
      evs.forEach((ev) => {
        const [experimentId, variationIndex] = ev.split("-");
        if (experimentId !== undefined && variationIndex !== undefined) {
          excludedExperimentVariations.push({
            experimentId: experimentId,
            variationIndex: Number(variationIndex),
          });
        }
      });
      group.excludedExperimentVariations = excludedExperimentVariations;
    }
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
    localStorageKey: "metric-correlations-experiments",
  });

  const { hasCommercialFeature } = useUser();
  const hasMetricCorrelationCommercialFeature = hasCommercialFeature(
    "metric-correlations",
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

  if (allExperiments.length === 0) {
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
      <MetricCorrelationCard
        filteredExperiments={filteredExperiments}
        allExperiments={allExperiments}
        params={params[0]}
      />
    </Box>
  );
};

export const updateSearchParams = (
  params: Record<string, string>,
  deleteAll: boolean = false,
) => {
  const searchParams = new URLSearchParams(window.location.search);

  const shouldDelete = Object.keys(params).length > 0 && deleteAll;
  const shouldSet =
    Object.keys(params).length > 0 &&
    Object.entries(params).some(
      ([key, value]) => searchParams.get(key) !== value,
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
        },
      )
      .then();
  }
};

const formattedValueWithCI = (
  value: number,
  ci: [number, number],
  formatter: (value: number) => string,
) => {
  return `${formatter(value)} (${formatter(ci[0])} - ${formatter(ci[1])})`;
};

const MetricCorrelationCard = ({
  filteredExperiments,
  allExperiments,
  params,
}: {
  filteredExperiments: ExperimentInterfaceStringDates[];
  allExperiments: ExperimentInterfaceStringDates[];
  params?: MetricCorrelationParams;
}): React.ReactElement => {
  const { project, getExperimentMetricById, getFactTableById, metricGroups } =
    useDefinitions();
  const { theme } = useAppearanceUITheme();
  const computedTheme = theme === "light" ? "light" : "dark";
  const displayCurrency = useCurrency();

  const [metric1, setMetric1] = useState<string>(params?.m1 || "");
  const [metric2, setMetric2] = useState<string>(params?.m2 || "");
  const [differenceType, setDifferenceType] = useState<DifferenceType>(
    params?.diff || "relative",
  );
  const [excludedExperimentVariations, setExcludedExperimentVariations] =
    useState<{ experimentId: string; variationIndex: number }[]>(
      params?.excludedExperimentVariations || [],
    );

  // Counts driven off the full set of (non-bandit) experiments so the metric
  // dropdowns stay stable while the user adjusts the experiment filter.
  const metric1OptionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allExperiments.forEach((experiment) => {
      const metricIds = getAllMetricIdsFromExperiment(
        experiment,
        false,
        metricGroups,
      );
      metricIds.forEach((metricId) => {
        counts[metricId] = (counts[metricId] || 0) + 1;
      });
    });
    return counts;
  }, [allExperiments, metricGroups]);

  const metric2OptionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!metric1) return counts;

    allExperiments.forEach((exp) => {
      const ids = getAllMetricIdsFromExperiment(exp, false, metricGroups);
      if (!ids.includes(metric1)) return;
      ids.forEach((id) => {
        if (id === metric1) return;
        counts[id] = (counts[id] || 0) + 1;
      });
    });
    return counts;
  }, [allExperiments, metricGroups, metric1]);

  // Sync URL params when user-controlled values change.
  useEffect(() => {
    if (!metric1 || !metric2) return;
    updateSearchParams(
      {
        m1_0: metric1,
        m2_0: metric2,
        diff_0: differenceType,
        excludedExperimentVariations_0: excludedExperimentVariations
          .map((ev) => `${ev.experimentId}-${ev.variationIndex}`)
          .join(","),
      },
      false,
    );
  }, [metric1, metric2, differenceType, excludedExperimentVariations]);

  const metric1Obj = getExperimentMetricById(metric1);
  const metric2Obj = getExperimentMetricById(metric2);

  const title =
    differenceType === "relative"
      ? "(Lift %)"
      : differenceType === "absolute"
        ? "(Absolute Change)"
        : "(Scaled Impact)";
  const metric1Name = metric1Obj ? `${metric1Obj.name} ${title}` : "";
  const metric2Name = metric2Obj ? `${metric2Obj.name} ${title}` : "";

  const getLiftFormatter = useCallback(
    (
      metric: ExperimentMetricDefinition | null,
      differenceType: DifferenceType,
    ) => {
      if (!metric) {
        return (value: number) => formatPercent(value);
      }
      if (differenceType === "relative") {
        return (value: number) => formatPercent(value);
      }
      return (value: number) =>
        getExperimentMetricFormatter(
          metric,
          getFactTableById,
          differenceType === "absolute" ? "percentagePoints" : "number",
        )(value, { currency: displayCurrency });
    },
    [getFactTableById, displayCurrency],
  );

  const formatterM1 = getLiftFormatter(metric1Obj, differenceType);
  const formatterM2 = getLiftFormatter(metric2Obj, differenceType);

  // All experiments (regardless of user filter) that include both metrics.
  // Drives the snapshot fetch so its cache key stays stable as the user
  // adjusts the experiment filter.
  const allExperimentsWithBothMetrics = useMemo(() => {
    if (!metric1 || !metric2) return [];
    return filterExperimentsByMetrics(
      allExperiments,
      metric1,
      metric2,
      metricGroups,
    );
  }, [allExperiments, metric1, metric2, metricGroups]);

  // Set of experiment ids that pass the user's current search/filter — used
  // to narrow the snapshot results in memory without invalidating the cache.
  const filteredExperimentIds = useMemo(
    () => new Set(filteredExperiments.map((e) => e.id)),
    [filteredExperiments],
  );

  // Stable cache key for SWR.
  const snapshotQueryIds = useMemo(
    () =>
      allExperimentsWithBothMetrics
        .map((e) => e.id)
        .sort()
        .map(encodeURIComponent)
        .join(","),
    [allExperimentsWithBothMetrics],
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

  const snapshotsLoading =
    !!metric1 &&
    !!metric2 &&
    allExperimentsWithBothMetrics.length > 0 &&
    !snapshotsData &&
    !snapshotsError;

  const { correlationData, filteredExperimentsWithSnapshot } = useMemo(() => {
    const empty = {
      correlationData: [] as ScatterPointData<MetricCorrelationTooltipData>[],
      filteredExperimentsWithSnapshot: [] as ExperimentWithSnapshot[],
    };

    if (!metric1 || !metric2 || !snapshotsData?.snapshots?.length) return empty;

    const snapshotsByExperiment = new Map<
      string,
      ExperimentSnapshotInterface
    >();
    snapshotsData.snapshots.forEach((s) => {
      snapshotsByExperiment.set(s.experiment, s);
    });

    const experimentsWithSnapshot: Record<string, ExperimentWithSnapshot> = {};
    const correlationData: ScatterPointData<MetricCorrelationTooltipData>[] =
      [];

    allExperimentsWithBothMetrics.forEach((experiment) => {
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

        const metric1Data = variation.metrics[metric1];
        const metric2Data = variation.metrics[metric2];

        if (metric1Data?.errorMessage || metric2Data?.errorMessage) {
          return;
        }

        if (!metric1Data || !metric2Data) return;

        if (!experimentsWithSnapshot[experiment.id]) {
          experimentsWithSnapshot[experiment.id] = {
            ...experiment,
            snapshot,
          };
        }

        const isExcluded = excludedExperimentVariations.some(
          (ev) =>
            ev.experimentId === experiment.id &&
            ev.variationIndex === variationIndex,
        );
        if (isExcluded) return;

        correlationData.push({
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
              getLatestPhaseVariations(experiment)[variationIndex]?.name || "",
            xMetricName: metric1Name,
            yMetricName: metric2Name,
          },
        });
      });
    });

    return {
      correlationData,
      filteredExperimentsWithSnapshot: Object.values(experimentsWithSnapshot),
    };
  }, [
    snapshotsData,
    allExperimentsWithBothMetrics,
    filteredExperimentIds,
    metric1,
    metric2,
    differenceType,
    excludedExperimentVariations,
    metric1Name,
    metric2Name,
  ]);

  if (Object.entries(metric1OptionCounts).length === 0) {
    return (
      <EmptyState
        title="Examine relationships between metrics"
        description="Explore how metrics are correlated in your experiments. To get
            started, create some experiments."
        leftButton={null}
        rightButton={
          <LinkButton href="/experiments">Setup experiments</LinkButton>
        }
        image={`/images/empty-states/metric_correlations_${computedTheme}.png`}
      />
    );
  }

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
          </Flex>
        </Flex>
        {!metric1 || !metric2 ? (
          <Flex align="center" justify="center" mt="3">
            <Box width="60%">
              <img
                src={`/images/empty-states/metric_correlations_${computedTheme}.png`}
                alt="Metric Correlations"
                style={{ width: "100%", height: "auto" }}
              />
            </Box>
          </Flex>
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
        ) : correlationData.length > 0 ||
          filteredExperimentsWithSnapshot.length > 0 ? (
          <Flex direction="column" gap="4">
            <Box mt="4">
              <Flex mt="2" align="center" justify="center" p="3">
                <ScatterPlotGraph
                  data={correlationData}
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
                          {formattedValueWithCI(
                            data.x,
                            [data.xmin, data.xmax],
                            formatterM1,
                          )}
                        </Text>
                      </Flex>
                      <Flex justify="between" gapX="2">
                        <Text weight="bold">{data.otherData.yMetricName}</Text>
                        <Text>
                          {formattedValueWithCI(
                            data.y,
                            [data.ymin, data.ymax],
                            formatterM2,
                          )}
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
            {metric1Obj && metric2Obj ? (
              <MetricCorrelationsExperimentTable
                experimentsWithSnapshot={filteredExperimentsWithSnapshot}
                metrics={[metric1Obj, metric2Obj]}
                bandits={false}
                numPerPage={50}
                differenceType={differenceType}
                excludedExperimentVariations={excludedExperimentVariations}
                setExcludedExperimentVariations={
                  setExcludedExperimentVariations
                }
              />
            ) : null}
          </Flex>
        ) : (
          <Box mt="4">
            <Callout status="info">
              No experiments found that match the current experiment filters and
              have both selected metrics.
            </Callout>
          </Box>
        )}
      </Box>
    </>
  );
};

export default MetricCorrelations;
