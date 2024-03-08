import Link from "next/link";
import React, { ReactElement, useCallback, useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { date, getValidDate } from "shared/dates";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import { useForm } from "react-hook-form";
import SelectField from "@/components/Forms/SelectField";
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

function jamesSteinAdjustment(
  effects: number[],
  se: number,
  useMean: boolean = false
) {
  const Ne = effects.length;
  const priorMean = useMean ? effects.reduce((a, b) => a + b, 0) / Ne : 0;
  const adj =
    ((Ne - 2) * Math.pow(se, 2)) /
    effects.reduce((a, b) => a + Math.pow(b - priorMean, 2), 0);
  return { mean: priorMean, adjustment: adj };
}

type ExperimentImpactFilters = {
  startDate: string;
  endDate: string;
  project: string;
  metric: string;
};

type ExperimentImpact = {
  endDate: Date;
  inSample: boolean;
  variations: {
    scaledImpact: number;
    scaledImpactAdjusted?: number;
    ci0?: number;
    selected: boolean;
  }[];
};

type ExperimentWithImpact = {
  keyVariationId?: number;
  impact?: ExperimentImpact;
  type: ExperimentImpactType;
  experiment: ExperimentInterfaceStringDates;
};

type ExperimentImpactType = "winner" | "loser" | "other";
type ExperimentImpactTab = ExperimentImpactType | "summary";

type ExperimentImpactData = {
  totalImpact: number;
  totalAdjustedImpact: number;
  experiments: ExperimentWithImpact[];
};

function formatImpact(
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

function ImpactTab({
  experimentImpactData,
  experimentImpactType,
  formatter,
  formatterOptions,
}: {
  experimentImpactData: ExperimentImpactData;
  experimentImpactType: ExperimentImpactType;
  formatter: (
    value: number,
    options?: Intl.NumberFormatOptions | undefined
  ) => string;
  formatterOptions: Intl.NumberFormatOptions;
}) {
  const expRows: ReactElement[] = [];

  experimentImpactData.experiments.forEach((e) => {
    const variations: JSX.Element[] = [];
    const impacts: JSX.Element[] = [];
    e.experiment.variations.forEach((v, i) => {
      if (i === 0) return;
      if (experimentImpactType !== "other" && i !== e.keyVariationId) return;
      const impact = e.impact?.variations?.[i - 1];
      variations.push(
        <div className={`variation variation${i} with-variation-label d-flex`}>
          <span className="label" style={{ width: 20, height: 20 }}>
            {i}
          </span>
          <span
            className="d-inline-block text-ellipsis hover"
            style={{
              maxWidth: 150,
            }}
          >
            {v.name}
          </span>
        </div>
      );
      impacts.push(
        <div className={experimentImpactType === "winner" ? "won" : ""}>
          {impact
            ? formatImpact(
                (impact?.scaledImpactAdjusted ?? 0) * 365,
                formatter,
                formatterOptions
              )
            : `N/A`}
          {!!impact && (
            <span className="plusminus ml-1">
              ±
              {Math.abs(impact?.ci0 ?? 0) === Infinity
                ? "∞"
                : formatter(
                    Math.abs(
                      ((impact?.scaledImpact ?? 0) - (impact?.ci0 ?? 0)) * 365
                    ),
                    formatterOptions
                  )}
            </span>
          )}
        </div>
      );
    });
    expRows.push(
      <tr key={e.experiment.id} className="hover-highlight">
        <td className="mb-1 ">
          <Link
            className="font-weight-bold"
            href={`/experiment/${e.experiment.id}`}
          >
            {e.experiment.name}
          </Link>
        </td>
        <td>
          {e.experiment.status === "stopped"
            ? date(
                e.experiment.phases?.[e.experiment.phases.length - 1]
                  ?.dateEnded ?? ""
              )
            : "N/A"}
        </td>
        <td>
          <div className="d-flex">
            {e.experiment.results ? (
              <div
                className="experiment-status-widget d-inline-block"
                style={{ height: 25, lineHeight: "25px" }}
              >
                <ResultsIndicator results={e.experiment.results} />
              </div>
            ) : (
              <ExperimentStatusIndicator status={e.experiment.status} />
            )}
          </div>
        </td>
        <td>{variations}</td>
        <td className="impact-results">{impacts}</td>
      </tr>
    );
  });
  return (
    <div className="px-3 py-3">
      {experimentImpactType !== "other" ? (
        <div
          className={`mt-2 alert alert-${
            experimentImpactType === "winner" ? "success" : "info"
          }`}
        >
          <span style={{ fontSize: "1.2em" }}>
            {formatImpact(
              experimentImpactData.totalAdjustedImpact * 365,
              formatter,
              formatterOptions
            )}
            {` per year is the summed impact ${
              experimentImpactType === "winner"
                ? "of the winning variations."
                : "of not shipping the worst variation."
            } `}
          </span>
        </div>
      ) : null}
      <div className="mt-4">
        <table className="table bg-white border">
          <thead className="bg-light">
            <tr>
              <th>Experiment</th>
              <th>Date Ended</th>
              <th>Status</th>
              <th>
                {experimentImpactType === "winner"
                  ? "Winning Variation"
                  : experimentImpactType === "loser"
                  ? "Worst Variation"
                  : "Variation"}
              </th>
              <th>Scaled Impact</th>
            </tr>
          </thead>
          <tbody>{expRows}</tbody>
          <tbody className="bg-light font-weight-bold">
            <tr>
              <td>Total Impact</td>
              <td colSpan={3} />
              <td>
                {formatImpact(
                  experimentImpactData.totalAdjustedImpact * 365,
                  formatter,
                  formatterOptions
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ExperimentImpact({
  experiments,
}: {
  experiments: ExperimentInterfaceStringDates[];
}) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();

  const now = new Date();
  const defaultStartDate = new Date(now);
  // last 180 days by default
  defaultStartDate.setDate(defaultStartDate.getDate() - 180);

  const form = useForm<ExperimentImpactFilters>({
    defaultValues: {
      startDate: defaultStartDate.toISOString().substring(0, 16),
      endDate: "",
      project: "",
      metric: settings.northStar?.metricIds?.[0] ?? "",
    },
  });

  const [impactTab, setImpactTab] = useState<ExperimentImpactTab>("summary");

  const [snapshots, setSnapshots] = useState<ExperimentSnapshotInterface[]>();
  const [loading, setLoading] = useState(true);
  const { metrics, project, projects, getFactTableById } = useDefinitions();
  const displayCurrency = useCurrency();

  const metric = form.watch("metric");
  const selectedProject = form.watch("project");

  // TODO just set form.setValue("project", project) when a project is selected in left nav
  const metricInterface = metrics.find((m) => m.id === metric);
  const formatter = metricInterface
    ? getExperimentMetricFormatter(metricInterface, getFactTableById, true)
    : formatNumber;

  const formatterOptions: Intl.NumberFormatOptions = {
    currency: displayCurrency,
    notation: "compact",
    signDisplay: "never",
  };

  // 1 get all snapshots
  // 2 check for snapshots w/o impact
  // 3 if snapshots exist w/o impact analysis object:
  //   upgrade those snapshots with scaled impact, then post
  const [experimentsWithNoImpact, setExperimentsWithNoImpact] = useState<
    string[]
  >([]);

  const setMissingAndBrokenScaledImpactExperiments = async (
    experiments: ExperimentInterfaceStringDates[],
    snapshots: ExperimentSnapshotInterface[] | undefined
  ) => {
    const experimentsWithNoImpact: string[] = [];
    experiments.forEach((e) => {
      const s = (snapshots ?? []).find((s) => s.experiment === e.id);
      if (!s) {
        return;
      }
      // get first analysis as that is always the "default"
      const defaultAnalysis = getSnapshotAnalysis(s);
      if (!defaultAnalysis) {
        return;
      }
      const scaledImpactAnalysisSettings: ExperimentSnapshotAnalysisSettings = {
        ...defaultAnalysis.settings,
        differenceType: "scaled",
      };
      const scaledAnalysis = getSnapshotAnalysis(
        s,
        scaledImpactAnalysisSettings
      );
      if (!scaledAnalysis || scaledAnalysis.status !== "success") {
        experimentsWithNoImpact.push(e.id);
      }
    });
    setExperimentsWithNoImpact(experimentsWithNoImpact);
  };

  const fetchSnapshots = useCallback(async () => {
    setLoading(true);
    const { snapshots } = await apiCall<{
      snapshots: ExperimentSnapshotInterface[];
    }>(
      `/experiments/snapshots/?ids=${experiments
        .map((e) => encodeURIComponent(e.id))
        .join(",")}`,
      {
        method: "GET",
      }
    );
    setSnapshots(snapshots);
    setMissingAndBrokenScaledImpactExperiments(experiments, snapshots);
    setLoading(false);
  }, [apiCall, experiments]);

  const updateSnapshots = useCallback(
    async (ids: string[]) => {
      setLoading(true);
      await apiCall<{
        snapshots: ExperimentSnapshotInterface[];
      }>("/experiments/snapshots/scaled/", {
        method: "POST",
        body: JSON.stringify({
          ids: ids,
        }),
      });
      // TODO error catching, return status to catch failed posts
    },
    [apiCall]
  );

  useEffect(() => {
    // 1 gets latest non-dimension snapshot from latest phase
    // and  2 check for snapshots w/o impact
    fetchSnapshots();
  }, [fetchSnapshots]);

  const [alreadyAutoPosted, setAlreadyAutoPosted] = useState(false);

  useEffect(() => {
    // 3 update snapshots missing impact
    if (experimentsWithNoImpact.length && !alreadyAutoPosted) {
      updateSnapshots(experimentsWithNoImpact).then(() => fetchSnapshots());
      setAlreadyAutoPosted(true);
    }
  }, [
    fetchSnapshots,
    updateSnapshots,
    experimentsWithNoImpact,
    alreadyAutoPosted,
    setAlreadyAutoPosted,
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
      const inSample =
        !!s &&
        // ended and end date is in range
        ((getValidDate(e.phases[e.phases.length - 1].dateEnded) >
          getValidDate(form.watch("startDate")) &&
          getValidDate(e.phases[e.phases.length - 1].dateStarted) <
            getValidDate(form.watch("endDate") ?? new Date())) ||
          (e.status === "running" &&
            (!form.watch("endDate") ||
              getValidDate(form.watch("endDate")) > new Date()))) &&
        // and in selected project
        (e.project === selectedProject || selectedProject === "");

      const summary =
        e.results === "won" && !!e.winner
          ? "winner"
          : e.results === "lost"
          ? "loser"
          : "other";

      const ei: ExperimentWithImpact = { experiment: e, type: summary };
      if (s) {
        const obj: ExperimentImpact = {
          endDate: s.settings.endDate,
          inSample: inSample,
          variations: [],
        };
        const defaultSettings = getSnapshotAnalysis(s)?.settings;
        const scaledAnalysis = defaultSettings
          ? getSnapshotAnalysis(s, {
              ...defaultSettings,
              differenceType: "scaled",
            })
          : null;

        if (scaledAnalysis && scaledAnalysis.results.length) {
          // no dim so always get first value
          const res = scaledAnalysis.results[0];
          res.variations.forEach((v, i) => {
            if (i !== 0) {
              const se = v?.metrics[metric]?.uplift?.stddev ?? 0;
              const impact = v?.metrics[metric]?.expected ?? 0;
              obj.variations.push({
                scaledImpact: impact,
                selected: e.winner === i,
                ci0: v?.metrics[metric]?.ci?.[0],
              });
              allScaledImpacts.push(impact);

              const totalUnits = v.users + res.variations[0].users;
              if (totalUnits > maxUnits && se > 0) {
                overallSE = se;
              }
            }
          });
        }
        ei.impact = obj;
      }
      experimentImpacts.set(e.id, ei);
    });

    const adjustment = jamesSteinAdjustment(allScaledImpacts, overallSE ?? 0);

    summaryObj = {
      winners: {
        totalAdjustedImpact: 0,
        totalImpact: 0,
        experiments: [],
      },
      losers: {
        totalAdjustedImpact: 0,
        totalImpact: 0,
        experiments: [],
      },
      others: {
        totalAdjustedImpact: 0,
        totalImpact: 0,
        experiments: [],
      },
    };
    for (const e of experimentImpacts.values()) {
      if (e?.impact?.inSample) {
        let experimentImpact: number | null = null;
        let experimentAdjustedImpact: number | null = null;

        e.impact.variations.forEach((v, vi) => {
          const adjustedImpact =
            adjustment.mean +
            (1 - adjustment.adjustment) * (v.scaledImpact - adjustment.mean);
          v.scaledImpactAdjusted = adjustedImpact;

          if (e.experiment.results === "won" && v.selected) {
            e.keyVariationId = vi + 1;
            experimentImpact = v.scaledImpact;
            experimentAdjustedImpact = v.scaledImpactAdjusted;
          } else if (e.experiment.results === "lost") {
            // only include biggest loser for "savings"
            if (v.scaledImpact < (experimentImpact ?? Infinity)) {
              e.keyVariationId = vi + 1;
              experimentImpact = v.scaledImpact;
              experimentAdjustedImpact = v.scaledImpactAdjusted;
            }
          }
        });

        if (e.experiment.results === "won") {
          summaryObj.winners.totalImpact += experimentImpact ?? 0;
          summaryObj.winners.totalAdjustedImpact +=
            experimentAdjustedImpact ?? 0;
          summaryObj.winners.experiments.push(e);
        } else if (e.experiment.results === "lost") {
          // invert sign of lost impact
          summaryObj.losers.totalImpact -= experimentImpact ?? 0;
          summaryObj.losers.totalAdjustedImpact -=
            experimentAdjustedImpact ?? 0;
          summaryObj.losers.experiments.push(e);
        } else {
          summaryObj.others.experiments.push(e);
        }
      }
    }
  }
  return (
    <div>
      <h3>Experiment Impact</h3>
      <div className="mb-4">
        <div className="d-flex align-items-center">
          <div className="mr-4">
            <small>Metric</small>
            <MetricSelector
              value={metric}
              onChange={(metric) => form.setValue("metric", metric)}
              project={project ? project : undefined}
              includeFacts={true}
            />
          </div>

          <div>
            <small>Project</small>
            <SelectField
              value={project ? project : selectedProject}
              options={[
                ...(project ? [] : [{ value: "", label: "All" }]),
                // TODO grey out projects that metric is not in
                ...projects
                  .filter((p) => project === "" || p.id === project)
                  .map((p) => ({ value: p.id, label: p.name })),
              ]}
              onChange={(v) => form.setValue("project", v)}
            />
          </div>

          <div className="flex-1 mr-4" />

          <div>
            <small>Date</small>
            <div className="d-flex align-items-center ">
              <Field type="datetime-local" {...form.register("startDate")} />
              <div className="m-2">{" to "}</div>
              <Field type="datetime-local" {...form.register("endDate")} />
            </div>
          </div>
        </div>
      </div>
      {/* TODO null state when all arrays are empty */}

      {loading ? (
        <LoadingSpinner />
      ) : summaryObj ? (
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
            <div className="mt-2">
              <table className="table bg-white text-center w-auto">
                <thead>
                  <tr>
                    <th style={{ width: 150 }} className="border-top-0" />
                    <th style={{ width: 200 }} className="border-top-0">
                      <div
                        className="d-inline-block badge-success rounded-circle mr-1"
                        style={{ width: 10, height: 10 }}
                      />
                      Winners
                    </th>
                    <th style={{ width: 200 }} className="border-top-0">
                      <div
                        className="d-inline-block badge-danger rounded-circle mr-1"
                        style={{ width: 10, height: 10 }}
                      />
                      Losers
                    </th>
                    <th style={{ width: 200 }} className="border-top-0">
                      <div
                        className="d-inline-block badge-secondary rounded-circle mr-1"
                        style={{ width: 10, height: 10 }}
                      />
                      Others
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
                          )}
                        </span>
                        <div className="text-muted small">
                          summed impact per year
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
                          )}
                        </span>
                        <div className="text-muted small">
                          summed saved impact per year
                        </div>
                      </div>
                    </td>
                    <td className="impact-results">
                      <div>
                        <span style={{ fontSize: "1.2em" }}>
                          {formatImpact(
                            summaryObj.others.totalAdjustedImpact * 365,
                            formatter,
                            formatterOptions
                          )}
                        </span>
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
            display={"Winners"}
            count={summaryObj.winners.experiments.length}
            padding={false}
          >
            <ImpactTab
              experimentImpactData={summaryObj.winners}
              experimentImpactType={"winner"}
              formatter={formatter}
              formatterOptions={formatterOptions}
            />
          </Tab>

          <Tab
            key={"loser"}
            id={"loser"}
            display={"Losers"}
            count={summaryObj.losers.experiments.length}
            padding={false}
          >
            <ImpactTab
              experimentImpactData={summaryObj.losers}
              experimentImpactType={"loser"}
              formatter={formatter}
              formatterOptions={formatterOptions}
            />
          </Tab>

          <Tab
            key={"other"}
            id={"other"}
            display={"Others"}
            count={summaryObj.others.experiments.length}
            padding={false}
          >
            <ImpactTab
              experimentImpactData={summaryObj.others}
              experimentImpactType={"other"}
              formatter={formatter}
              formatterOptions={formatterOptions}
            />
          </Tab>
        </ControlledTabs>
      ) : null}
    </div>
  );
}
