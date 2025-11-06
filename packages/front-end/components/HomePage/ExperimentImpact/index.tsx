import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import { Flex } from "@radix-ui/themes";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { datetime, getValidDate } from "shared/dates";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import { formatNumber, getExperimentMetricFormatter } from "@/services/metrics";
import MetricSelector from "@/components/Experiment/MetricSelector";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Switch from "@/ui/Switch";
import Tooltip from "@/components/Tooltip/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Avatar from "@/ui/Avatar";
import DSTooltip from "@/ui/Tooltip";
import DatePicker from "@/components/DatePicker";
import { GBInfo } from "@/components/Icons";
import { jamesSteinAdjustment } from "./JamesSteinAdjustment";
import ExperimentImpactTab from "./ExperimentImpactTab";

export function NoExperimentsForImpactBanner() {
  return (
    <div className={`mt-2 alert alert-warning`}>
      <span style={{ fontSize: "1.2em" }}>
        0 experiments for which we could compute scaled impact match your
        filters.
      </span>
    </div>
  );
}

export function formatImpact(
  impact: number,
  formatter: (
    value: number,
    options?: Intl.NumberFormatOptions | undefined,
  ) => string,
  formatterOptions: Intl.NumberFormatOptions,
) {
  if (impact === 0) {
    return <>N/A</>;
  }
  return (
    <>
      <span className="expectedArrows">
        {impact > 0 ? <FaArrowUp /> : impact < 0 ? <FaArrowDown /> : null}
      </span>{" "}
      <span className="expected font-weight-bold">
        {formatter(impact, { ...formatterOptions, signDisplay: "never" })}
      </span>
    </>
  );
}

export type ExperimentImpactType = "winner" | "loser" | "other";
type ExperimentWithImpact = {
  experiment: ExperimentInterfaceStringDates;
  variationImpact: {
    scaledImpact: number;
    scaledImpactAdjusted?: number;
    se: number;
    selected: boolean;
  }[];
  type: ExperimentImpactType;
  keyVariationId?: number;
  keyVariationImpact?: {
    scaledImpact: number;
    scaledImpactAdjusted?: number;
    se: number;
  };
  error?: string;
};

export type ExperimentImpactTab = ExperimentImpactType | "summary";

export type ExperimentImpactData = {
  totalAdjustedImpact: number;
  totalAdjustedImpactVariance: number;
  experiments: ExperimentWithImpact[];
};

type ExperimentImpactSummary = {
  winners: ExperimentImpactData;
  losers: ExperimentImpactData;
  others: ExperimentImpactData;
};

export function scaleImpactAndSetMissingExperiments({
  experiments,
  snapshots,
  metric,
  selectedProjects,
  startDate,
  endDate,
  adjusted,
}: {
  experiments: ExperimentInterfaceStringDates[];
  snapshots: ExperimentSnapshotInterface[] | undefined;
  metric: string;
  selectedProjects: string[];
  startDate: string;
  endDate: string | undefined;
  adjusted: boolean;
}): {
  summaryObj: ExperimentImpactSummary | null;
  nExpsUsedForAdjustment: number;
  experimentsWithNoImpact: string[];
} {
  // experiments that fit the filter
  const exps = experiments
    .filter((e) => {
      if (!e.phases.length) return false;
      const experimentEndDate = getValidDate(
        e.phases[e.phases.length - 1]?.dateEnded,
      );
      const filterStartDate = getValidDate(startDate);
      const filterEndDate = getValidDate(endDate ?? new Date());

      const endedAfterStart = experimentEndDate > filterStartDate;
      const endedBeforeEnd = experimentEndDate < filterEndDate;
      const isRunningAndEndInFuture =
        e.status === "running" &&
        (!endDate || getValidDate(endDate) > new Date());

      const fitsDateFilter =
        (endedAfterStart && endedBeforeEnd) || isRunningAndEndInFuture;
      const { metricGroups } = useDefinitions();
      const hasMetric = getAllMetricIdsFromExperiment(
        e,
        false,
        metricGroups,
      ).includes(metric);
      const inSelectedProject =
        selectedProjects.includes(e.project ?? "") || !selectedProjects.length;

      return hasMetric && fitsDateFilter && inSelectedProject;
    })
    .sort(
      (a, b) =>
        getValidDate(
          b.phases[b.phases.length - 1].dateEnded ?? new Date(),
        ).getTime() -
        getValidDate(
          a.phases[a.phases.length - 1].dateEnded ?? new Date(),
        ).getTime(),
    );

  let nExpsUsedForAdjustment = 0;
  const experimentsWithNoImpact: string[] = [];
  const experimentImpacts = new Map<string, ExperimentWithImpact>();
  let summaryObj: ExperimentImpactSummary | null = null;
  if (snapshots && exps) {
    // use largest experiment for population sampling variance
    const maxUnits = 0;
    let overallSE: number | null = null;
    const allScaledImpacts: number[] = [];
    exps.forEach((e) => {
      const s = snapshots.find((s) => s.experiment === e.id);

      const summary =
        e.results === "won" && !!e.winner && e.status === "stopped"
          ? "winner"
          : e.results === "lost" && e.status === "stopped"
            ? "loser"
            : "other";

      const ei: ExperimentWithImpact = {
        experiment: e,
        type: summary,
        variationImpact: [],
      };

      if (s) {
        const defaultAnalysis = getSnapshotAnalysis(s);
        const defaultSettings = defaultAnalysis?.settings;
        const scaledAnalysis = defaultSettings
          ? getSnapshotAnalysis(s, {
              ...defaultSettings,
              differenceType: "scaled",
            })
          : null;

        if (scaledAnalysis && scaledAnalysis.results.length) {
          // count experiments used for James-Stein adjustment
          nExpsUsedForAdjustment += 1;

          // no dim so always get first value
          const res = scaledAnalysis.results[0];
          res.variations.forEach((v, i) => {
            if (i !== 0) {
              const se = v?.metrics[metric]?.uplift?.stddev ?? 0;
              const impact = v?.metrics[metric]?.expected ?? 0;
              ei.variationImpact.push({
                scaledImpact: impact,
                selected: e.winner === i,
                se: se,
              });

              allScaledImpacts.push(impact);

              const totalUnits = v.users + res.variations[0].users;
              if (totalUnits > maxUnits && se > 0) {
                overallSE = se;
              }
            }
          });
        } else {
          if (defaultAnalysis && defaultAnalysis.status === "success") {
            ei.error =
              "No snapshot with scaled impact available. Click calculate button above.";
            experimentsWithNoImpact.push(e.id);
          } else {
            ei.error =
              "No results available. Check experiment results for errors.";
          }
        }
      } else {
        ei.error =
          "No results available. Run experiment update on experiment page.";
      }
      experimentImpacts.set(e.id, ei);
    });

    const adjustment = jamesSteinAdjustment(allScaledImpacts, overallSE ?? 0);

    const applyAdjustment = adjusted && nExpsUsedForAdjustment >= 5;
    summaryObj = {
      winners: {
        totalAdjustedImpact: 0,
        totalAdjustedImpactVariance: 0,
        experiments: [],
      },
      losers: {
        totalAdjustedImpact: 0,
        totalAdjustedImpactVariance: 0,
        experiments: [],
      },
      others: {
        totalAdjustedImpact: 0,
        totalAdjustedImpactVariance: 0,
        experiments: [],
      },
    };
    for (const e of experimentImpacts.values()) {
      let experimentImpact: number | null = null;
      let experimentAdjustedImpact: number | null = null;
      let experimentAdjustedImpactStdDev: number | null = null;

      e.variationImpact.forEach((v, vi) => {
        const adjustedImpact =
          adjustment.mean +
          (1 - adjustment.adjustment) * (v.scaledImpact - adjustment.mean);
        v.scaledImpactAdjusted = applyAdjustment
          ? adjustedImpact
          : v.scaledImpact;

        if (e.type === "winner" && v.selected) {
          e.keyVariationId = vi + 1;
          experimentImpact = v.scaledImpact;
          experimentAdjustedImpact = v.scaledImpactAdjusted;
          experimentAdjustedImpactStdDev = v.se;
        } else if (e.type === "loser") {
          // only include biggest loser for "savings"
          if (v.scaledImpact < (experimentImpact ?? Infinity)) {
            e.keyVariationId = vi + 1;
            experimentImpact = v.scaledImpact;
            experimentAdjustedImpact = v.scaledImpactAdjusted;
            experimentAdjustedImpactStdDev = v.se;
          }
        }
      });

      if (
        experimentImpact !== null &&
        experimentAdjustedImpact !== null &&
        experimentAdjustedImpactStdDev !== null
      ) {
        e.keyVariationImpact = {
          scaledImpact: experimentImpact,
          scaledImpactAdjusted: experimentAdjustedImpact,
          se: experimentAdjustedImpactStdDev,
        };
      }

      if (e.type === "winner") {
        summaryObj.winners.totalAdjustedImpact += experimentAdjustedImpact ?? 0;
        summaryObj.winners.totalAdjustedImpactVariance += Math.pow(
          experimentAdjustedImpactStdDev ?? 0,
          2,
        );
        summaryObj.winners.experiments.push(e);
      } else if (e.type === "loser") {
        // invert sign of lost impact
        summaryObj.losers.totalAdjustedImpact -= experimentAdjustedImpact ?? 0;
        summaryObj.losers.totalAdjustedImpactVariance += Math.pow(
          experimentAdjustedImpactStdDev ?? 0,
          2,
        );
        summaryObj.losers.experiments.push(e);
      } else {
        summaryObj.others.experiments.push(e);
      }
    }
  }
  return {
    summaryObj,
    nExpsUsedForAdjustment,
    experimentsWithNoImpact,
  };
}

export default function ExperimentImpact({
  experiments: allExperiments,
}: {
  experiments: ExperimentInterfaceStringDates[];
}) {
  const experiments = allExperiments.filter(
    (exp) => exp.type !== "multi-armed-bandit",
  );
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const displayCurrency = useCurrency();

  const { metrics, project, projects, getFactTableById } = useDefinitions();

  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<ExperimentSnapshotInterface[]>();

  const experimentIds = experiments.map((e) => e.id);

  const now = new Date();
  const defaultStartDate = new Date(now);
  // last 180 days by default
  defaultStartDate.setDate(defaultStartDate.getDate() - 180);

  const form = useForm<{
    startDate: string;
    endDate: string;
    projects: string[];
    metric: string;
    adjusted: boolean;
  }>({
    defaultValues: {
      startDate: defaultStartDate.toISOString().substring(0, 10),
      endDate: "",
      projects: [],
      metric: settings.northStar?.metricIds?.[0] ?? "",
      adjusted: false,
    },
  });

  const metric = form.watch("metric");
  const selectedProjects = form.watch("projects");
  const adjusted = form.watch("adjusted");
  const startDate = form.watch("startDate");
  const endDate = form.watch("endDate");

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
    [apiCall],
  );

  useEffect(() => {
    // 1 gets latest non-dimension snapshot from latest phase
    fetchSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2 check for snapshots w/o impact and update data
  const { summaryObj, nExpsUsedForAdjustment, experimentsWithNoImpact } =
    useMemo(
      () =>
        scaleImpactAndSetMissingExperiments({
          experiments,
          snapshots,
          metric,
          selectedProjects,
          startDate,
          endDate,
          adjusted,
        }),
      [
        experiments,
        snapshots,
        metric,
        selectedProjects,
        startDate,
        endDate,
        adjusted,
      ],
    );

  return (
    <div className="pt-2">
      <h3 className="mt-2 mb-3 mr-4">Experiment Impact</h3>
      <div className="row align-items-start mb-4">
        <div className="col-3">
          <label className="mb-1">Metric</label>
          <MetricSelector
            value={metric}
            onChange={(metric) => form.setValue("metric", metric)}
            projects={selectedProjects}
            includeFacts={true}
          />
        </div>

        <div className="col-auto" style={{ maxWidth: 250 }}>
          <label className="mb-1">Projects</label>
          <MultiSelectField
            placeholder="All projects"
            value={project ? [project] : selectedProjects}
            disabled={!!project}
            options={projects
              .filter((p) => project === "" || p.id === project)
              .map((p) => ({ value: p.id, label: p.name }))}
            onChange={(v) => form.setValue("projects", v)}
          />
        </div>

        <div className="col-auto">
          <label className="mb-1">Date Ended</label>
          <div className="d-flex align-items-start">
            <DatePicker
              date={form.watch("startDate")}
              setDate={(v) => {
                form.setValue("startDate", v ? datetime(v) : "");
              }}
              scheduleEndDate={form.watch("endDate")}
              disableAfter={form.watch("endDate") || undefined}
              precision="date"
            />
            <div className="m-2">{" to "}</div>
            <DatePicker
              date={form.watch("endDate")}
              setDate={(v) => {
                form.setValue("endDate", v ? datetime(v) : "");
              }}
              scheduleStartDate={form.watch("startDate")}
              disableBefore={form.watch("startDate") || undefined}
              precision="date"
              helpText={
                form.getValues("endDate") !== "" ? (
                  <div style={{ marginRight: -10 }}>
                    <a
                      role="button"
                      className="a"
                      onClick={(e) => {
                        e.preventDefault();
                        form.setValue("endDate", "");
                      }}
                    >
                      Clear Input
                    </a>{" "}
                    to include today
                  </div>
                ) : null
              }
            />
          </div>
        </div>
        <div className="col pl-3">
          <Flex align="center" gap="1">
            <DSTooltip
              content="Disabled as there are not enough experiments to shrink estimates"
              enabled={nExpsUsedForAdjustment < 5}
            >
              <Switch
                id="adjust-scaled-impact"
                label="De-bias?"
                disabled={nExpsUsedForAdjustment < 5}
                onChange={(v) => form.setValue("adjusted", v)}
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
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : summaryObj ? (
        <>
          {experimentsWithNoImpact.length > 0 ? (
            <div className={`mt-2 alert alert-warning`}>
              <div className="row">
                <div className="col-auto">
                  <span style={{ fontSize: "1.2em" }}>
                    Some experiments are missing scaled impact results.
                  </span>
                </div>
                <div className="flex-1" />
                <div className="col-auto">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() =>
                      updateSnapshots(experimentsWithNoImpact).then(
                        fetchSnapshots,
                      )
                    }
                  >
                    Calculate Scaled Impact
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {summaryObj.losers.experiments.length +
            summaryObj.winners.experiments.length +
            summaryObj.others.experiments.length ===
          0 ? (
            <NoExperimentsForImpactBanner />
          ) : null}
          <Tabs defaultValue="summary">
            <TabsList>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="winner">
                Won
                <Avatar color="gray" variant="soft" ml="2" size="sm">
                  {summaryObj.winners.experiments.length}
                </Avatar>
              </TabsTrigger>
              <TabsTrigger value="loser">
                Lost
                <Avatar color="gray" variant="soft" ml="2" size="sm">
                  {summaryObj.losers.experiments.length}
                </Avatar>
              </TabsTrigger>
              <TabsTrigger value="other">
                Other
                <Avatar color="gray" variant="soft" ml="2" size="sm">
                  {summaryObj.others.experiments.length}
                </Avatar>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="summary">
              <div className="px-3 pt-3">
                <table className="table text-center w-auto mb-0">
                  <thead>
                    <tr>
                      <th style={{ width: 150 }} className="border-top-0" />
                      <th style={{ width: 200 }} className="border-top-0">
                        <div
                          className="d-inline-block badge-success rounded-circle mr-1"
                          style={{ width: 10, height: 10 }}
                        />
                        Won
                      </th>
                      <th style={{ width: 200 }} className="border-top-0">
                        <div
                          className="d-inline-block badge-danger rounded-circle mr-1"
                          style={{ width: 10, height: 10 }}
                        />
                        Lost
                      </th>
                      <th style={{ width: 200 }} className="border-top-0">
                        <div
                          className="d-inline-block badge-secondary rounded-circle mr-1"
                          style={{ width: 10, height: 10 }}
                        />
                        Other
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="text-left">Experiments</td>
                      <td>{summaryObj.winners.experiments.length}</td>
                      <td>{summaryObj.losers.experiments.length}</td>
                      <td>{summaryObj.others.experiments.length}</td>
                    </tr>
                    <tr>
                      <td className="font-weight-bold text-left">
                        Scaled Impact
                      </td>
                      <td className="impact-results">
                        <div className="won">
                          <span style={{ fontSize: "1.2em" }}>
                            {formatImpact(
                              summaryObj.winners.totalAdjustedImpact * 365,
                              formatter,
                              formatterOptions,
                            )}{" "}
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
                          </span>
                          <div>
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
                                        We compute the Daily Scaled Impact for
                                        all variations in all experiments that
                                        match your filters.
                                      </li>
                                      <li>
                                        If de-biasing is on, we use a
                                        James-Stein adjustment to shrink
                                        estimates towards zero to mitigate
                                        selection bias.
                                      </li>
                                      <li>
                                        We sum the Scaled Impact of the winning
                                        variation of experiments marked as won
                                        and multiply values by 365 to get an
                                        annual value.
                                      </li>
                                    </ol>
                                  </div>
                                  <div>{`The plus-minus value represents a 95% confidence interval.`}</div>
                                </div>
                              }
                            >
                              <span className="small font-weight-bold">
                                summed impact / year
                              </span>{" "}
                              <GBInfo />
                            </Tooltip>
                          </div>
                        </div>
                      </td>
                      <td className="impact-results">
                        <div>
                          <span style={{ fontSize: "1.2em" }}>
                            {formatImpact(
                              summaryObj.losers.totalAdjustedImpact * 365,
                              formatter,
                              formatterOptions,
                            )}{" "}
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
                          </span>
                          <div>
                            <Tooltip
                              popperClassName="text-left"
                              body={
                                <div>
                                  <div className="mb-2">
                                    This value is the sum of the adjusted scaled
                                    impacts of the worst variation from
                                    experiments marked as Lost.
                                  </div>
                                  <div className="mb-2">
                                    <ol>
                                      <li>
                                        We compute the Daily Scaled Impact for
                                        all variations in all experiments that
                                        match your filters.
                                      </li>
                                      <li>
                                        If de-biasing is on, we use a
                                        James-Stein adjustment to shrink
                                        estimates towards zero to mitigate
                                        selection bias.
                                      </li>
                                      <li>
                                        We sum the Scaled Impact of the worst
                                        variation of experiments marked as lost
                                        and multiply values by 365 to get an
                                        annual value.
                                      </li>
                                    </ol>
                                  </div>
                                  <div>{`The plus-minus value represents a 95% confidence interval.`}</div>
                                </div>
                              }
                            >
                              <span className="small text-muted font-weight-bold">
                                avoided loss / year
                              </span>{" "}
                              <GBInfo />
                            </Tooltip>
                          </div>
                        </div>
                      </td>
                      <td className="impact-results">
                        <div>
                          <span style={{ fontSize: "1.2em" }}>N/A</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="winner">
              <ExperimentImpactTab
                experimentImpactData={summaryObj.winners}
                experimentImpactType={"winner"}
                formatter={formatter}
                formatterOptions={formatterOptions}
              />
            </TabsContent>

            <TabsContent value="loser">
              <ExperimentImpactTab
                experimentImpactData={summaryObj.losers}
                experimentImpactType={"loser"}
                formatter={formatter}
                formatterOptions={formatterOptions}
              />
            </TabsContent>

            <TabsContent value="other">
              <ExperimentImpactTab
                experimentImpactData={summaryObj.others}
                experimentImpactType={"other"}
                formatter={formatter}
                formatterOptions={formatterOptions}
              />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}
