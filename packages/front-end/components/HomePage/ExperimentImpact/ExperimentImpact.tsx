import Link from "next/link";
import React, { ReactElement, useCallback, useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { date, getValidDate } from "shared/dates";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { FaArrowDown, FaArrowUp, FaExclamationTriangle } from "react-icons/fa";
import { useForm } from "react-hook-form";
import clsx from "clsx";
import { MdInfoOutline } from "react-icons/md";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import { formatNumber, getExperimentMetricFormatter } from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import Tab from "@/components/Tabs/Tab";
import Field from "@/components/Forms/Field";
import MetricSelector from "@/components/Experiment/MetricSelector";
import LoadingSpinner from "@/components/LoadingSpinner";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import Toggle from "@/components/Forms/Toggle";
import { ExperimentImpactTab } from "@/components/HomePage/ExperimentImpact/ExperimentImpactTab";

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
    options?: Intl.NumberFormatOptions | undefined
  ) => string,
  formatterOptions: Intl.NumberFormatOptions
) {
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

type ExperimentImpactFilters = {
  startDate: string;
  endDate: string;
  projects: string[];
  metric: string;
  adjusted: boolean;
};

type ExperimentImpact = {
  inSample: boolean;
  variations: {
    scaledImpact: number;
    scaledImpactAdjusted?: number;
    se: number;
    selected: boolean;
  }[];
};

type ExperimentWithImpact = {
  keyVariationId?: number;
  impact: ExperimentImpact;
  type: ExperimentImpactType;
  experiment: ExperimentInterfaceStringDates;
  error?: string;
};

export type ExperimentImpactType = "winner" | "loser" | "other";
export type ExperimentImpactTab = ExperimentImpactType | "summary";

export type ExperimentImpactData = {
  totalAdjustedImpact: number;
  totalAdjustedImpactVariance: number;
  experiments: ExperimentWithImpact[];
};

export default function ExperimentImpact({
  experiments,
}: {
  experiments: ExperimentInterfaceStringDates[];
}) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const displayCurrency = useCurrency();

  const { metrics, project, projects, getFactTableById } = useDefinitions();

  const [loading, setLoading] = useState(true);
  const [impactTab, setImpactTab] = useState<ExperimentImpactTab>("summary");
  const [snapshots, setSnapshots] = useState<ExperimentSnapshotInterface[]>();
  const [experimentsWithNoImpact, setExperimentsWithNoImpact] = useState<
    string[]
  >([]);
  const [hasTriedRebuildingImpact, setHasTriedRebuildingImpact] = useState(
    false
  );

  const experimentIds = experiments.map((e) => e.id);

  const now = new Date();
  const defaultStartDate = new Date(now);
  // last 180 days by default
  defaultStartDate.setDate(defaultStartDate.getDate() - 180);

  const form = useForm<ExperimentImpactFilters>({
    defaultValues: {
      startDate: defaultStartDate.toISOString().substring(0, 16),
      endDate: "",
      projects: [],
      metric: settings.northStar?.metricIds?.[0] ?? "",
      adjusted: false,
    },
  });

  const metric = form.watch("metric");
  const selectedProjects = form.watch("projects");
  const adjusted = form.watch("adjusted");

  const metricInterface = metrics.find((m) => m.id === metric);
  const formatter = metricInterface
    ? getExperimentMetricFormatter(metricInterface, getFactTableById, true)
    : formatNumber;

  const formatterOptions: Intl.NumberFormatOptions = {
    currency: displayCurrency,
    notation: "compact",
    signDisplay: "never",
    maximumSignificantDigits: 3,
  };

  // 1 get all snapshots
  // 2 check for snapshots w/o impact
  // 3 if snapshots exist w/o impact analysis object:
  //   upgrade those snapshots with scaled impact, then post

  const setMissingAndBrokenScaledImpactExperiments = (
    experiments: ExperimentInterfaceStringDates[],
    snapshots: ExperimentSnapshotInterface[] | undefined
  ) => {
    const experimentsWithNoImpact: string[] = [];
    experiments.forEach((e) => {
      const s = (snapshots ?? []).find((s) => s.experiment === e.id);
      if (!s) return;
      // get first analysis as that is always the "default"
      const defaultAnalysis = getSnapshotAnalysis(s);
      if (!defaultAnalysis) return;
      const scaledImpactAnalysisSettings: ExperimentSnapshotAnalysisSettings = {
        ...defaultAnalysis.settings,
        differenceType: "scaled",
      };
      const scaledAnalysis = getSnapshotAnalysis(
        s,
        scaledImpactAnalysisSettings
      );
      if (scaledAnalysis?.status !== "success") {
        experimentsWithNoImpact.push(e.id);
      }
    });
    setExperimentsWithNoImpact(experimentsWithNoImpact);
  };

  const fetchSnapshots = useCallback(async () => {
    setLoading(true);
    const queryIds = experimentIds
      .map((id) => encodeURIComponent(id))
      .join(",");
    try {
      const { snapshots } = await apiCall<{
        snapshots: ExperimentSnapshotInterface[];
      }>(`/experiments/snapshots/?ids=${queryIds}`, {
        method: "GET",
      });
      setSnapshots(snapshots);
      setMissingAndBrokenScaledImpactExperiments(experiments, snapshots);
    } catch (error) {
      console.error(`Error getting snapshots: ${error.message}`);
    }
    setLoading(false);
  }, [apiCall, experimentIds, experiments]);

  const updateSnapshots = useCallback(
    async (ids: string[]) => {
      try {
        setLoading(true);
        await apiCall<{
          snapshots: ExperimentSnapshotInterface[];
        }>("/experiments/snapshots/scaled/", {
          method: "POST",
          body: JSON.stringify({
            ids: ids,
          }),
        });
      } catch (error) {
        console.error(`Error creating scaled impact: ${error.message}`);
      }
    },
    [apiCall]
  );

  useEffect(
    () => {
      // 1 gets latest non-dimension snapshot from latest phase
      // and  2 check for snapshots w/o impact
      setHasTriedRebuildingImpact(false);
      fetchSnapshots();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(experimentIds)]
  );

  useEffect(() => {
    // 3 update snapshots missing impact
    if (experimentsWithNoImpact.length && !hasTriedRebuildingImpact) {
      updateSnapshots(experimentsWithNoImpact).then(fetchSnapshots);
      setHasTriedRebuildingImpact(true);
    }
  }, [
    fetchSnapshots,
    updateSnapshots,
    experimentsWithNoImpact,
    hasTriedRebuildingImpact,
    setHasTriedRebuildingImpact,
  ]);

  const exps = experiments
    .filter((e) =>
      [...e.metrics, ...(e.guardrails ?? [])].find((m) => m === metric)
    )
    .sort(
      (a, b) =>
        getValidDate(
          b.phases[b.phases.length - 1].dateEnded ?? new Date()
        ).getTime() -
        getValidDate(
          a.phases[a.phases.length - 1].dateEnded ?? new Date()
        ).getTime()
    );

  let nExpsUsedForAdjustment = 0;
  const experimentImpacts = new Map<string, ExperimentWithImpact>();
  let summaryObj: {
    winners: ExperimentImpactData;
    losers: ExperimentImpactData;
    others: ExperimentImpactData;
  } | null = null;
  if (snapshots && exps) {
    // use largest experiment for population sampling variance
    const maxUnits = 0;
    let overallSE: number | null = null;
    const allScaledImpacts: number[] = [];
    exps.forEach((e) => {
      const s = snapshots.find((s) => s.experiment === e.id);

      // Experiments to actually use in overall impact and in
      // tabs. We filter here instead of filtering `exp` because
      // we use the full set of experiments for the James-Stein
      // adjustment
      const fitsFilters =
        // ended and end date is in range or is running
        ((getValidDate(e.phases[e.phases.length - 1].dateEnded) >
          getValidDate(form.watch("startDate")) &&
          getValidDate(e.phases[e.phases.length - 1].dateStarted) <
            getValidDate(form.watch("endDate") ?? new Date())) ||
          (e.status === "running" &&
            (!form.watch("endDate") ||
              getValidDate(form.watch("endDate")) > new Date()))) &&
        // and in selected project
        (selectedProjects.includes(e.project ?? "") ||
          !selectedProjects.length);

      const summary =
        e.results === "won" && !!e.winner && e.status === "stopped"
          ? "winner"
          : e.results === "lost" && e.status === "stopped"
          ? "loser"
          : "other";

      if (fitsFilters) {
        console.dir(s, { depth: 3 });
      }
      const ei: ExperimentWithImpact = {
        experiment: e,
        type: summary,
        impact: {
          inSample: fitsFilters,
          variations: [],
        },
      };

      if (s) {
        const defaultSettings = getSnapshotAnalysis(s)?.settings;
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
              ei.impact.variations.push({
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
          ei.error = "No snapshot with scaled impact available.";
        }
      } else {
        ei.error = "No snapshot with results available.";
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
      if (e?.impact?.inSample) {
        let experimentImpact: number | null = null;
        let experimentAdjustedImpact: number | null = null;
        let experimentAdjustedImpactStdDev: number | null = null;

        e.impact.variations.forEach((v, vi) => {
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

        if (e.type === "winner") {
          summaryObj.winners.totalAdjustedImpact +=
            experimentAdjustedImpact ?? 0;
          summaryObj.winners.totalAdjustedImpactVariance += Math.pow(
            experimentAdjustedImpactStdDev ?? 0,
            2
          );
          summaryObj.winners.experiments.push(e);
        } else if (e.type === "loser") {
          // invert sign of lost impact
          summaryObj.losers.totalAdjustedImpact -=
            experimentAdjustedImpact ?? 0;
          summaryObj.losers.totalAdjustedImpactVariance += Math.pow(
            experimentAdjustedImpactStdDev ?? 0,
            2
          );
          summaryObj.losers.experiments.push(e);
        } else {
          summaryObj.others.experiments.push(e);
        }
      }
    }
  }

  return (
    <div className="pt-2">
      <div className="row align-items-start mb-4">
        <div className="col-md-12 col-lg-auto">
          <h3 className="mt-2 mb-3 mr-4">Experiment Impact</h3>
        </div>

        <div className="flex-1" />

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
            <Field type="date" {...form.register("startDate")} />
            <div className="m-2">{" to "}</div>
            <Field
              type="date"
              {...form.register("endDate")}
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
          <label className="mb-1">
            {"De-bias?"}
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
          </label>
          <div className="d-flex pl-3">
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
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : summaryObj ? (
        <>
          {summaryObj.losers.experiments.length +
            summaryObj.winners.experiments.length +
            summaryObj.others.experiments.length ===
          0 ? (
            <NoExperimentsForImpactBanner />
          ) : null}
          <ControlledTabs
            setActive={(s) => {
              setImpactTab((s as ExperimentImpactTab) || "summary");
            }}
            active={impactTab}
            showActiveCount={true}
            newStyle={false}
            buttonsClassName="px-3 py-2 h4"
          >
            <Tab
              key={"summary"}
              id={"summary"}
              display={"Summary"}
              padding={false}
            >
              <div className="px-3 pt-3">
                <table className="table bg-white text-center w-auto mb-0">
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
                              formatterOptions
                            )}{" "}
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
                              <MdInfoOutline className="text-info" />
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
                              formatterOptions
                            )}{" "}
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
                              <MdInfoOutline className="text-info" />
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
            </Tab>

            <Tab
              key={"winner"}
              id={"winner"}
              display={"Won"}
              count={summaryObj.winners.experiments.length}
              padding={false}
            >
              <ExperimentImpactTab
                experimentImpactData={summaryObj.winners}
                experimentImpactType={"winner"}
                formatter={formatter}
                formatterOptions={formatterOptions}
              />
            </Tab>

            <Tab
              key={"loser"}
              id={"loser"}
              display={"Lost"}
              count={summaryObj.losers.experiments.length}
              padding={false}
            >
              <ExperimentImpactTab
                experimentImpactData={summaryObj.losers}
                experimentImpactType={"loser"}
                formatter={formatter}
                formatterOptions={formatterOptions}
              />
            </Tab>

            <Tab
              key={"other"}
              id={"other"}
              display={"Other"}
              count={summaryObj.others.experiments.length}
              padding={false}
            >
              <ExperimentImpactTab
                experimentImpactData={summaryObj.others}
                experimentImpactType={"other"}
                formatter={formatter}
                formatterOptions={formatterOptions}
              />
            </Tab>
          </ControlledTabs>
        </>
      ) : null}
    </div>
  );
}