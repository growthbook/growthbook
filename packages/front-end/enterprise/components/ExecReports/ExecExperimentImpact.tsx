import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { useForm } from "react-hook-form";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { useAuth } from "@/services/auth";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import { formatNumber, getExperimentMetricFormatter } from "@/services/metrics";
import {
  scaleImpactAndSetMissingExperiments,
  formatImpact,
} from "@/components/HomePage/ExperimentImpact";
import MetricSelector from "@/components/Experiment/MetricSelector";
import Tooltip from "@/components/Tooltip/Tooltip";
import Switch from "@/ui/Switch";
import { ExperimentDot } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import SelectField from "@/components/Forms/SelectField";
import DSTooltip from "@/ui/Tooltip";
import track, { TrackEventProps } from "@/services/track";
import { isCloud } from "@/services/env";
import Link from "@/ui/Link";

interface ExperimentSummaryType {
  experiment: ExperimentInterfaceStringDates;
  type: "winner" | "loser" | "other";
  scaledImpact?: {
    scaledImpact: number;
    scaledImpactAdjusted?: number | undefined;
    se: number;
  };
}

function getColor(val: number | undefined): string {
  const defVal = val ?? 0;
  return defVal > 0
    ? "var(--green-11)"
    : defVal < 0
      ? "var(--red-11)"
      : "var(--slate-11)";
}

export default function ExecExperimentImpact({
  allExperiments,
  startDate,
  endDate,
  metric,
  setMetric,
  projects = [],
  experimentsToShow,
  setExperimentsToShow,
  embedded = false,
}: {
  allExperiments: ExperimentInterfaceStringDates[];
  projects?: string[];
  startDate?: Date;
  endDate?: Date;
  metric: string;
  setMetric?: (metric: string) => void;
  experimentsToShow: string;
  setExperimentsToShow: (experimentsToShow: string) => void;
  // When embedded (e.g. as a dashboard block), the metric selector and header
  // are owned by the surrounding chrome, so hide the internal ones.
  embedded?: boolean;
}) {
  const NUM_EXP_TO_SHOW = 5;

  const {
    getExperimentMetricById,
    getFactTableById,
    getProjectById,
    metricGroups,
  } = useDefinitions();

  const experiments = useMemo(() => {
    if (!metric) return [];
    return allExperiments
      .filter((exp) => exp.type !== "multi-armed-bandit")
      .filter((exp) => {
        const ids = getAllMetricIdsFromExperiment(exp, false, metricGroups);
        // Only experiments that contain the selected metric
        return ids.includes(metric);
      });
  }, [allExperiments, metricGroups, metric]);
  const { apiCall } = useAuth();
  const displayCurrency = useCurrency();

  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<ExperimentSnapshotInterface[]>();
  const [snapshotLoadFailed, setSnapshotLoadFailed] = useState(false);
  const [showAllExperiments, setShowAllExperiments] = useState(false);
  const [hasBeenViewed, setHasBeenViewed] = useState(false);

  const form = useForm<{
    adjusted: boolean;
  }>({
    defaultValues: {
      adjusted: false,
    },
  });

  const adjusted = form.watch("adjusted");
  const surface = embedded ? "dashboard-block" : "executive-dashboard";
  const impactContainerRef = useRef<HTMLDivElement | null>(null);
  const viewedRef = useRef(false);
  const lastTrackedResultsKeyRef = useRef("");

  const trackInteraction = useCallback(
    (action: string, properties: TrackEventProps = {}) => {
      track("Experiment Impact Interacted", {
        surface,
        action,
        ...(metric ? { metricId: metric } : {}),
        ...properties,
      });
    },
    [metric, surface],
  );

  const metricInterface = getExperimentMetricById(metric);
  const formatter = metricInterface
    ? getExperimentMetricFormatter(metricInterface, getFactTableById, "number")
    : formatNumber;

  const formatterOptions: Intl.NumberFormatOptions = {
    currency: displayCurrency,
    notation: "compact",
    signDisplay: "never",
    maximumSignificantDigits: 3,
  };

  const metricExpCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allExperiments.forEach((exp) => {
      const ids = getAllMetricIdsFromExperiment(exp, false, metricGroups);
      ids.forEach((id) => {
        counts[id] = (counts[id] || 0) + 1;
      });
    });
    return counts;
  }, [allExperiments, metricGroups]);

  // 1 get all snapshots
  // 2 check for snapshots w/o impact
  const fetchSnapshots = useCallback(
    async (experiments: ExperimentInterfaceStringDates[]) => {
      const experimentIds = experiments
        .map((e) => encodeURIComponent(e.id))
        .join(",");
      if (!experimentIds) {
        setSnapshots([]);
        setSnapshotLoadFailed(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      setSnapshotLoadFailed(false);
      try {
        const { snapshots } = await apiCall<{
          snapshots: ExperimentSnapshotInterface[];
        }>(`/experiments/snapshots/?experiments=${experimentIds}`, {
          method: "GET",
        });
        setSnapshots(snapshots);
      } catch (error) {
        setSnapshots(undefined);
        setSnapshotLoadFailed(true);
        console.error(`Error getting snapshots: ${error.message}`);
      }
      setLoading(false);
    },
    [apiCall],
  );

  const updateSnapshots = useCallback(
    async (ids: string[]) => {
      try {
        setLoading(true);
        await apiCall<{
          snapshots: ExperimentSnapshotInterface[];
        }>("/experiments/snapshots/scaled/", {
          method: "POST",
          body: JSON.stringify({
            experiments: ids,
          }),
        });
      } catch (error) {
        console.error(`Error creating scaled impact: ${error.message}`);
      }
    },
    [apiCall],
  );

  useEffect(() => {
    // 1 gets latest non-dimension snapshot from latest phase
    fetchSnapshots(experiments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiments]);

  // 2 check for snapshots w/o impact and update data
  const {
    summaryObj,
    nExpsUsedForAdjustment,
    experimentsWithNoImpact,
    estimatedShrinkageFactor,
    appliedShrinkageFactor,
  } = useMemo(
    () =>
      scaleImpactAndSetMissingExperiments({
        experiments,
        snapshots,
        metric,
        selectedProjects: projects,
        startDate: startDate?.toISOString() || "",
        endDate: endDate?.toISOString() || "",
        adjusted,
        // The embedded (dashboard block) input is already date-filtered by
        // the shared result-date helper, so skip the redundant date filter
        // here to stay consistent with Win Percentage / Team Velocity.
        skipDateFilter: embedded,
      }),
    [
      experiments,
      snapshots,
      metric,
      projects,
      startDate,
      endDate,
      adjusted,
      embedded,
    ],
  );

  const availabilityState = !metric
    ? "metric_required"
    : experiments.length === 0
      ? "no_matching_metric_experiments"
      : snapshotLoadFailed
        ? "data_load_failed"
        : experimentsWithNoImpact.length > 0
          ? "scaled_impact_missing"
          : "ready";

  useEffect(() => {
    if (loading) return;
    track("Experiment Impact Availability Evaluated", {
      surface,
      entitled: true,
      state: availabilityState,
      ...(metric ? { metricId: metric } : {}),
      experimentCount: experiments.length,
      missingScaledImpactCount: experimentsWithNoImpact.length,
    });
  }, [
    availabilityState,
    experiments.length,
    experimentsWithNoImpact.length,
    loading,
    metric,
    snapshotLoadFailed,
    surface,
  ]);

  useEffect(() => {
    const element = impactContainerRef.current;
    if (loading || !element || viewedRef.current) return;

    const trackViewed = () => {
      if (viewedRef.current) return;
      viewedRef.current = true;
      setHasBeenViewed(true);
      track("Experiment Impact Viewed", {
        surface,
        state: availabilityState,
        ...(metric ? { metricId: metric } : {}),
        experimentCount: experiments.length,
        missingScaledImpactCount: experimentsWithNoImpact.length,
        hasResults: !!summaryObj,
      });
    };

    if (typeof IntersectionObserver === "undefined") {
      trackViewed();
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          trackViewed();
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [
    availabilityState,
    experiments.length,
    experimentsWithNoImpact.length,
    loading,
    metric,
    summaryObj,
    surface,
  ]);

  useEffect(() => {
    if (!isCloud() || !hasBeenViewed || !summaryObj || !metric) return;

    const resultRows = (
      [
        ["winner", summaryObj.winners.experiments],
        ["loser", summaryObj.losers.experiments],
        ["other", summaryObj.others.experiments],
      ] as const
    ).flatMap(([resultType, resultExperiments]) =>
      resultExperiments.flatMap((resultExperiment) => {
        if (!resultExperiment.snapshotId || !resultExperiment.analysisKey) {
          return [];
        }
        return resultExperiment.variationImpact.map(
          (variationImpact, variationOffset) => ({
            experimentId: resultExperiment.experiment.id,
            snapshotId: resultExperiment.snapshotId,
            analysisKey: resultExperiment.analysisKey,
            variationIndex: variationOffset + 1,
            resultType,
            isKeyVariation:
              resultExperiment.keyVariationId === variationOffset + 1,
            selected: variationImpact.selected,
            scaledImpact: variationImpact.scaledImpact,
            scaledImpactAdjusted:
              variationImpact.scaledImpactAdjusted ??
              variationImpact.scaledImpact,
            standardError: variationImpact.se,
            relativeEffect: variationImpact.relativeEffect,
            relativeEffectStandardError:
              variationImpact.relativeEffectStandardError,
          }),
        );
      }),
    );

    const resultsKey = JSON.stringify({
      metric,
      surface,
      appliedShrinkageFactor,
      resultRows,
    });
    if (lastTrackedResultsKeyRef.current === resultsKey) return;
    lastTrackedResultsKeyRef.current = resultsKey;

    resultRows.forEach((result) => {
      track("Experiment Impact Result Evaluated", {
        surface,
        metricId: metric,
        ...result,
        annualScaledImpact: result.scaledImpact * 365,
        annualScaledImpactAdjusted: result.scaledImpactAdjusted * 365,
        debiasEnabled: adjusted,
        adjustmentEligible: nExpsUsedForAdjustment >= 5,
        adjustmentExperimentCount: nExpsUsedForAdjustment,
        estimatedShrinkageFactor,
        appliedShrinkageFactor,
      });
    });
  }, [
    adjusted,
    appliedShrinkageFactor,
    estimatedShrinkageFactor,
    hasBeenViewed,
    metric,
    nExpsUsedForAdjustment,
    summaryObj,
    surface,
  ]);

  // top winning experiments by scaled impact:
  const topWinningExperiments = useMemo(() => {
    if (!summaryObj) return [];
    return summaryObj.winners.experiments
      .filter((e) => e.keyVariationImpact)
      .map((e) => {
        const expDat: ExperimentSummaryType = {
          experiment: e.experiment,
          type: "winner",
          scaledImpact: e.keyVariationImpact,
        };
        return expDat;
      })
      .sort(
        (a, b) =>
          (b.scaledImpact?.scaledImpact || 0) -
          (a.scaledImpact?.scaledImpact || 0),
      );
  }, [summaryObj]);

  const topLostExperiments = useMemo(() => {
    if (!summaryObj) return [];
    return summaryObj.losers.experiments
      .filter((e) => e.keyVariationImpact)
      .map((e) => {
        const expDat: ExperimentSummaryType = {
          experiment: e.experiment,
          type: "loser",
          scaledImpact: e.keyVariationImpact,
        };
        return expDat;
      })
      .sort(
        (a, b) =>
          (b.scaledImpact?.scaledImpact || 0) -
          (a.scaledImpact?.scaledImpact || 0),
      );
  }, [summaryObj]);

  const topOtherExperiments = useMemo(() => {
    if (!summaryObj) return [];
    return summaryObj.others.experiments
      .map((e) => {
        const expDat: ExperimentSummaryType = {
          experiment: e.experiment,
          type: "other",
          scaledImpact: undefined,
        };
        return expDat;
      })
      .sort(
        (a, b) =>
          getValidDate(
            b.experiment.phases[b.experiment.phases.length - 1]?.dateEnded,
          ).getTime() -
          getValidDate(
            a.experiment.phases[a.experiment.phases.length - 1]?.dateEnded,
          ).getTime(),
      );
  }, [summaryObj]);

  const topAllExperiments = useMemo(() => {
    // combine top winning, lost, and other experiments, and sort by scaled Impact:
    return [
      ...topWinningExperiments,
      ...topLostExperiments,
      ...topOtherExperiments,
    ].sort(
      (a, b) =>
        (b.scaledImpact?.scaledImpact || 0) -
        (a.scaledImpact?.scaledImpact || 0),
    );
  }, [topLostExperiments, topOtherExperiments, topWinningExperiments]);

  // depending on the value of `experimentsToShow`, select which experiments to show:
  const showExperiments = useMemo(() => {
    let showExps: ExperimentSummaryType[] = [];
    if (experimentsToShow === "all") {
      showExps = topAllExperiments;
    } else if (experimentsToShow === "won") {
      showExps = topWinningExperiments;
    } else if (experimentsToShow === "lost") {
      showExps = topLostExperiments;
    } else if (experimentsToShow === "other") {
      showExps = topOtherExperiments;
    }
    return showExps;
  }, [
    experimentsToShow,
    topAllExperiments,
    topWinningExperiments,
    topLostExperiments,
    topOtherExperiments,
  ]);

  // if we are going to show more experiments than NUM_EXP_TO_SHOW, we will show a "Show all" link
  const showMoreExperiments = showExperiments.length > NUM_EXP_TO_SHOW;
  const trimmedExperimentList = !showAllExperiments
    ? showExperiments.slice(0, NUM_EXP_TO_SHOW)
    : showExperiments;

  if (loading) {
    return (
      <Box width="100%" pt="3">
        Loading...
      </Box>
    );
  }
  return (
    <Box ref={impactContainerRef}>
      {!embedded && (
        <Flex justify="between" align="start" mb="2">
          <Box>
            <Heading as="h3" size="3">
              Scaled Impact{" "}
              <Tooltip
                body={
                  "This shows the estimated impact of experiments that have been marked as Won or Lost."
                }
              />
            </Heading>
            <Heading as="h4" size="2" weight="regular" mb="0">
              {projects.length > 0
                ? projects.map((p) => getProjectById(p)?.name).join(", ")
                : "All Projects"}
            </Heading>
          </Box>
          <Flex align="center" gap="3" width="30%">
            <label className="mb-1">Metric</label>
            <MetricSelector
              value={metric}
              onChange={(nextMetric) => {
                if (setMetric) {
                  trackInteraction("metric_changed", {
                    hasSelection: !!nextMetric,
                    ...(nextMetric ? { metricId: nextMetric } : {}),
                  });
                  setMetric(nextMetric);
                }
              }}
              projects={projects}
              includeFacts={true}
              containerClassName="w-100"
              filterMetrics={(m) => {
                // Only show metrics that are used in the experiments
                return m.id === metric || !!metricExpCounts[m.id];
              }}
              sortMetrics={(a, b) => {
                // Metrics with the most experiments first
                return (
                  (metricExpCounts[b.id] || 0) - (metricExpCounts[a.id] || 0)
                );
              }}
            />
          </Flex>
        </Flex>
      )}
      <Flex gap="5" align="start" mb="0" mt="0">
        {metric && startDate && endDate ? (
          <>
            <Box
              flexBasis="31%"
              flexShrink="1"
              mt="8"
              style={{ position: "relative" }}
            >
              <Box>
                {summaryObj ? (
                  <>
                    {experimentsWithNoImpact.length > 0 ? (
                      <Callout
                        status="warning"
                        mt="2"
                        action={
                          <Button
                            color="inherit"
                            onClick={async () => {
                              trackInteraction(
                                "calculate_scaled_impact_requested",
                                {
                                  experimentCount:
                                    experimentsWithNoImpact.length,
                                  experimentIds: experimentsWithNoImpact,
                                },
                              );
                              await updateSnapshots(experimentsWithNoImpact);
                              await fetchSnapshots(experiments);
                            }}
                          >
                            Calculate Scaled Impact
                          </Button>
                        }
                      >
                        Some experiments are missing scaled impact results.
                      </Callout>
                    ) : null}
                    <Box p="2" px="3" className="appbox" mb="3">
                      <Flex gap="2" align="center">
                        <ExperimentDot color="green" />
                        <Text weight="medium">Won</Text>
                        <Tooltip
                          popperClassName="text-left"
                          body={
                            <div>
                              <div className="mb-2">
                                This value is the sum of the adjusted scaled
                                impacts of the winning variations from
                                experiments marked as Won.
                              </div>
                              <div className="mb-2">
                                <ol>
                                  <li>
                                    We compute the Daily Scaled Impact for all
                                    variations in all experiments that match
                                    your filters.
                                  </li>
                                  <li>
                                    If de-biasing is on, we use a James-Stein
                                    adjustment to shrink estimates towards zero
                                    to mitigate selection bias.
                                  </li>
                                  <li>
                                    We sum the Scaled Impact of the winning
                                    variation of experiments marked as won and
                                    multiply values by 365 to get an annual
                                    value.
                                  </li>
                                </ol>
                              </div>
                              <div>{`The plus-minus value represents a 95% confidence interval.`}</div>
                            </div>
                          }
                        ></Tooltip>
                      </Flex>
                      <Flex gap="2" align="center">
                        <Flex gap="2" align="center">
                          <Box style={{ fontSize: "1.6em" }}>
                            <span
                              style={{
                                color: getColor(
                                  summaryObj.winners.totalAdjustedImpact,
                                ),
                              }}
                            >
                              {formatImpact(
                                summaryObj.winners.totalAdjustedImpact * 365,
                                formatter,
                                formatterOptions,
                              )}
                            </span>
                          </Box>
                          <Box>
                            {summaryObj.winners.totalAdjustedImpactVariance ? (
                              <span className="plusminus ml-1">
                                ±{" "}
                                {formatter(
                                  Math.sqrt(
                                    summaryObj.winners
                                      .totalAdjustedImpactVariance,
                                  ) *
                                    1.96 *
                                    365,
                                  formatterOptions,
                                )}
                              </span>
                            ) : null}
                          </Box>
                        </Flex>
                        <Box flexGrow="1"></Box>
                        <Flex justify="end">
                          <span className="small text-right">
                            based on {summaryObj.winners.experiments.length}{" "}
                            experiment
                            {summaryObj.winners.experiments.length > 1
                              ? "s"
                              : ""}
                            <br />
                            summed impact over a year
                          </span>
                        </Flex>
                      </Flex>
                    </Box>
                    <Box p="2" px="3" className="appbox" mb="3">
                      <Flex gap="2" align="center">
                        <ExperimentDot color="red" />
                        <Text weight="medium">Avoided loss</Text>
                        <Tooltip
                          popperClassName="text-left"
                          body={
                            <div>
                              <div className="mb-2">
                                This value is the sum of the adjusted scaled
                                impacts of the worst variation from experiments
                                marked as Lost.
                              </div>
                              <div className="mb-2">
                                <ol>
                                  <li>
                                    We compute the Daily Scaled Impact for all
                                    variations in all experiments that match
                                    your filters.
                                  </li>
                                  <li>
                                    If de-biasing is on, we use a James-Stein
                                    adjustment to shrink estimates towards zero
                                    to mitigate selection bias.
                                  </li>
                                  <li>
                                    We sum the Scaled Impact of the worst
                                    variation of experiments marked as lost and
                                    multiply values by 365 to get an annual
                                    value.
                                  </li>
                                </ol>
                              </div>
                              <div>{`The plus-minus value represents a 95% confidence interval.`}</div>
                            </div>
                          }
                        ></Tooltip>
                      </Flex>
                      <Flex>
                        <Flex gap="2" align="center">
                          <Box style={{ fontSize: "1.6em" }}>
                            {formatImpact(
                              summaryObj.losers.totalAdjustedImpact * 365,
                              formatter,
                              formatterOptions,
                            )}
                          </Box>
                          <Box>
                            {summaryObj.losers.totalAdjustedImpactVariance ? (
                              <span className="plusminus ml-1">
                                ±{" "}
                                {formatter(
                                  Math.sqrt(
                                    summaryObj.losers
                                      .totalAdjustedImpactVariance,
                                  ) *
                                    1.96 *
                                    365,
                                  formatterOptions,
                                )}
                              </span>
                            ) : null}
                          </Box>
                        </Flex>
                        <Box flexGrow="1"></Box>
                        <Flex justify="end">
                          <span className="small text-right">
                            based on {summaryObj.losers.experiments.length}{" "}
                            experiment
                            {summaryObj.losers.experiments.length > 1
                              ? "s"
                              : ""}
                            <br />
                            avoided loss over a year
                          </span>
                        </Flex>
                      </Flex>
                    </Box>
                    <Box>
                      <Flex gap="5" align="center" justify="start">
                        <Flex align="center" gap="1">
                          <DSTooltip
                            content="Disabled as there are not enough experiments to shrink estimates"
                            enabled={nExpsUsedForAdjustment < 5}
                          >
                            <Switch
                              id="adjust-scaled-impact"
                              label="De-bias?"
                              disabled={nExpsUsedForAdjustment < 5}
                              onChange={(v) => {
                                trackInteraction("debias_toggled", {
                                  enabled: v,
                                });
                                form.setValue("adjusted", v);
                              }}
                              value={adjusted && nExpsUsedForAdjustment >= 5}
                            />
                          </DSTooltip>
                          <Tooltip
                            body={
                              <>
                                <div className="mb-2">
                                  {
                                    "Whether to use the James-Stein shrinkage estimator to compute an adjustment factor to mitigate selection bias from summing only a subset of experiments (e.g. winners)."
                                  }
                                </div>

                                {nExpsUsedForAdjustment >= 5 ? (
                                  <div>{`To estimate the background variance in treatment effects used for the James-Stein estimator, we use all ${nExpsUsedForAdjustment} experiments that have ever used this metric and for which we can compute scaled impact, regardless of your project or date filters.`}</div>
                                ) : null}
                              </>
                            }
                          />
                        </Flex>
                      </Flex>
                    </Box>
                  </>
                ) : (
                  <></>
                )}
              </Box>
            </Box>
            <Box flexGrow="1">
              <table className="table gbtable w-100">
                <thead>
                  <tr>
                    <th>
                      <Flex>
                        <SelectField
                          size="legacy"
                          containerClassName={"select-dropdown-underline"}
                          options={[
                            {
                              label: "All Experiments ",
                              value: "all",
                            },
                            {
                              label: "Top Winning Experiments ",
                              value: "won",
                            },
                            {
                              label: "Top Loss Avoided Experiments ",
                              value: "lost",
                            },
                            {
                              label: "Other Experiments ",
                              value: "other",
                            },
                          ]}
                          sort={false}
                          value={experimentsToShow}
                          onChange={(v) => {
                            trackInteraction("experiment_filter_changed", {
                              filter: v,
                            });
                            setExperimentsToShow(v);
                          }}
                          style={{
                            borderBottom: "0",
                          }}
                        />
                      </Flex>
                    </th>
                    <th>Scaled Impact</th>
                    <th
                      className="text-right"
                      style={{
                        paddingTop: 0,
                        paddingBottom: 0,
                        paddingRight: "0.0rem",
                      }}
                    >
                      <Flex direction="column">
                        <Box>
                          Annual Scaled Impact{" "}
                          <Tooltip
                            className="ml-1"
                            body={
                              <>
                                <div className="mb-2">
                                  {`This Daily Scaled Impact, available in your Experiment Results under the "Scaled Impact" Difference Type, is adjusted if de-biasing is set to true and multiplied by 365 to yield the Annual Adjusted Scaled Impact.`}
                                </div>
                              </>
                            }
                          />
                        </Box>
                        <Box mr="4">
                          <span className="small text-muted">
                            &times; adj &times; 365
                          </span>
                        </Box>
                      </Flex>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {trimmedExperimentList.map((obj) => {
                    return (
                      <tr key={obj.experiment.id}>
                        <td
                          className="text-left"
                          style={{ padding: "0.5rem 0.2rem" }}
                        >
                          <Link
                            href={`/experiment/${obj.experiment.id}`}
                            className="d-block"
                            onClick={() => {
                              trackInteraction("experiment_opened", {
                                experimentId: obj.experiment.id,
                                resultType: obj.type,
                              });
                            }}
                          >
                            <Flex align="center" gap="2">
                              <ExperimentDot
                                color={
                                  obj.type === "winner"
                                    ? "green"
                                    : obj.type == "loser"
                                      ? "red"
                                      : "gray"
                                }
                              />{" "}
                              {obj.experiment.name}
                            </Flex>
                          </Link>
                        </td>
                        <td style={{ padding: "0.4rem" }}>
                          {obj.type === "other" ? (
                            <span className="text-muted">{`N/A ${
                              obj.experiment.results === "dnf"
                                ? "- Did Not Finish"
                                : obj.experiment.results === "inconclusive"
                                  ? "- Inconclusive"
                                  : ""
                            }`}</span>
                          ) : obj.scaledImpact ? (
                            <span
                              style={{
                                color: getColor(obj.scaledImpact.scaledImpact),
                              }}
                            >
                              {formatImpact(
                                obj.scaledImpact.scaledImpact,
                                formatter,
                                formatterOptions,
                              )}
                            </span>
                          ) : (
                            <span className="text-muted">N/A</span>
                          )}
                        </td>
                        <td
                          className="text-right"
                          style={{ padding: "0.4rem" }}
                        >
                          <Flex gap="2" align="center" justify="end">
                            <Box>
                              {obj?.scaledImpact?.scaledImpact ? (
                                <span
                                  style={{
                                    color: getColor(
                                      obj.scaledImpact.scaledImpact,
                                    ),
                                  }}
                                >
                                  {formatImpact(
                                    (adjusted
                                      ? (obj.scaledImpact
                                          .scaledImpactAdjusted ??
                                        obj.scaledImpact.scaledImpact)
                                      : obj.scaledImpact.scaledImpact) * 365,
                                    formatter,
                                    formatterOptions,
                                  )}
                                </span>
                              ) : (
                                <>-</>
                              )}
                            </Box>
                            <Box>
                              {!!obj?.scaledImpact && obj?.scaledImpact.se && (
                                <span className="plusminus ml-1 text-muted">
                                  ±{" "}
                                  {formatter(
                                    obj?.scaledImpact.se * 1.96 * 365,
                                    formatterOptions,
                                  )}
                                </span>
                              )}
                            </Box>
                          </Flex>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {showMoreExperiments && (
                <Box mb="4" mt="2">
                  <Flex justify="center">
                    <Link
                      onClick={() => {
                        trackInteraction("experiment_list_toggled", {
                          expanded: !showAllExperiments,
                          experimentCount: showExperiments.length,
                        });
                        setShowAllExperiments(!showAllExperiments);
                      }}
                    >
                      {showAllExperiments
                        ? "Show fewer"
                        : `Show all ${showExperiments.length} experiments`}
                    </Link>
                  </Flex>
                </Box>
              )}
              {summaryObj &&
              summaryObj.losers.experiments.length +
                summaryObj.winners.experiments.length +
                summaryObj.others.experiments.length ===
                0 ? (
                <Callout status="info" mb="3" mt="3">
                  There are no experiments for which we could compute scaled
                  impact for this metric and date range.
                </Callout>
              ) : null}
            </Box>
          </>
        ) : (
          <Box width="100%" pt="3">
            <Callout status="info" mb="3">
              {Object.keys(metricExpCounts).length === 0
                ? "There are no experiments with metrics in the selected project and date range."
                : "Select a metric to see the impact."}
            </Callout>
          </Box>
        )}
      </Flex>
    </Box>
  );
}
