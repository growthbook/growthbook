import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useForm } from "react-hook-form";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import Link from "next/link";
import { getValidDate } from "shared/dates";
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
import Toggle from "@/components/Forms/Toggle";
import { ExperimentDot } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Callout from "@/components/Radix/Callout";
import SelectField from "@/components/Forms/SelectField";

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
  filteredExperiments,
  allExperiments,
  startDate,
  endDate,
  metric,
  setMetric,
  projects = [],
  experimentsToShow,
  setExperimentsToShow,
}: {
  filteredExperiments: ExperimentInterfaceStringDates[];
  allExperiments: ExperimentInterfaceStringDates[];
  projects?: string[];
  startDate?: Date;
  endDate?: Date;
  metric: string;
  setMetric?: (metric: string) => void;
  experimentsToShow: string;
  setExperimentsToShow: (experimentsToShow: string) => void;
}) {
  const NUM_EXP_TO_SHOW = 5;
  const experiments = allExperiments.filter(
    (exp) => exp.type !== "multi-armed-bandit"
  );
  const { apiCall } = useAuth();
  const displayCurrency = useCurrency();

  const { metrics, getFactTableById, getProjectById } = useDefinitions();

  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<ExperimentSnapshotInterface[]>();
  const [showAllExperiments, setShowAllExperiments] = useState(false);

  const experimentIds = experiments.map((e) => e.id);

  const form = useForm<{
    adjusted: boolean;
  }>({
    defaultValues: {
      adjusted: false,
    },
  });

  const adjusted = form.watch("adjusted");

  const metricInterface = metrics.find((m) => m.id === metric);
  const formatter = metricInterface
    ? getExperimentMetricFormatter(metricInterface, getFactTableById, "number")
    : formatNumber;

  const formatterOptions: Intl.NumberFormatOptions = {
    currency: displayCurrency,
    notation: "compact",
    signDisplay: "never",
    maximumSignificantDigits: 3,
  };

  // 1 get all snapshots
  // 2 check for snapshots w/o impact
  const fetchSnapshots = useCallback(async () => {
    setLoading(true);
    const queryIds = experimentIds
      .map((id) => encodeURIComponent(id))
      .join(",");
    try {
      const { snapshots } = await apiCall<{
        snapshots: ExperimentSnapshotInterface[];
      }>(`/experiments/snapshots/?experiments=${queryIds}`, {
        method: "GET",
      });
      setSnapshots(snapshots);
    } catch (error) {
      console.error(`Error getting snapshots: ${error.message}`);
    }
    setLoading(false);
  }, [apiCall, experimentIds]);

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
    [apiCall]
  );

  useEffect(() => {
    // 1 gets latest non-dimension snapshot from latest phase
    fetchSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2 check for snapshots w/o impact and update data
  const {
    summaryObj,
    nExpsUsedForAdjustment,
    experimentsWithNoImpact,
  } = useMemo(
    () =>
      scaleImpactAndSetMissingExperiments({
        experiments: allExperiments,
        filteredExperimentIds: filteredExperiments.map((e) => e.id),
        snapshots,
        metric,
        selectedProjects: projects,
        startDate: startDate?.toISOString() || "",
        endDate: endDate?.toISOString() || "",
        adjusted,
      }),
    [
      allExperiments,
      filteredExperiments,
      snapshots,
      metric,
      projects,
      startDate,
      endDate,
      adjusted,
    ]
  );

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
          (a.scaledImpact?.scaledImpact || 0)
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
          (a.scaledImpact?.scaledImpact || 0)
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
            b.experiment.phases[b.experiment.phases.length - 1]?.dateEnded
          ).getTime() -
          getValidDate(
            a.experiment.phases[a.experiment.phases.length - 1]?.dateEnded
          ).getTime()
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
        (a.scaledImpact?.scaledImpact || 0)
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
    <>
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
            onChange={(metric) => {
              if (setMetric) {
                setMetric(metric);
              }
            }}
            projects={projects}
            includeFacts={true}
            containerClassName="w-100"
          />
        </Flex>
      </Flex>
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
                      <div className={`mt-2 alert alert-warning`}>
                        <div className="row">
                          <div className="col-auto">
                            <span>
                              Some experiments are missing scaled impact
                              results.
                            </span>
                          </div>
                          <div className="flex-1" />
                          <div className="col-auto">
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() =>
                                updateSnapshots(experimentsWithNoImpact).then(
                                  fetchSnapshots
                                )
                              }
                            >
                              Calculate Scaled Impact
                            </button>
                          </div>
                        </div>
                      </div>
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
                                  summaryObj.winners.totalAdjustedImpact
                                ),
                              }}
                            >
                              {formatImpact(
                                summaryObj.winners.totalAdjustedImpact * 365,
                                formatter,
                                formatterOptions
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
                                      .totalAdjustedImpactVariance
                                  ) *
                                    1.96 *
                                    365,
                                  formatterOptions
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
                              formatterOptions
                            )}
                          </Box>
                          <Box>
                            {summaryObj.losers.totalAdjustedImpactVariance ? (
                              <span className="plusminus ml-1">
                                ±{" "}
                                {formatter(
                                  Math.sqrt(
                                    summaryObj.losers
                                      .totalAdjustedImpactVariance
                                  ) *
                                    1.96 *
                                    365,
                                  formatterOptions
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
                        <label className="nowrap mb-0">
                          De-bias?
                          <Tooltip
                            className="ml-1"
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
                        </label>
                        <Box>
                          <Toggle
                            id="adjust-scaled-impact"
                            className="form-check-input"
                            disabled={nExpsUsedForAdjustment < 5}
                            disabledMessage={
                              "Disabled as there are not enough experiments to shrink estimates"
                            }
                            setValue={(v) => form.setValue("adjusted", v)}
                            value={adjusted && nExpsUsedForAdjustment >= 5}
                          />
                        </Box>
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
                                formatterOptions
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
                                      obj.scaledImpact.scaledImpact
                                    ),
                                  }}
                                >
                                  {formatImpact(
                                    (adjusted
                                      ? obj.scaledImpact.scaledImpactAdjusted ??
                                        obj.scaledImpact.scaledImpact
                                      : obj.scaledImpact.scaledImpact) * 365,
                                    formatter,
                                    formatterOptions
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
                                    formatterOptions
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
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setShowAllExperiments(!showAllExperiments);
                      }}
                    >
                      {showAllExperiments
                        ? "Show fewer"
                        : `Show all ${showExperiments.length} experiments`}
                    </a>
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
              Select a metric to see the impact
            </Callout>
          </Box>
        )}
      </Flex>
    </>
  );
}
