import Link from "next/link";
import React, { useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { date, getValidDate } from "shared/dates";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import { useForm } from "react-hook-form";
import { HiOutlineExclamationCircle } from "react-icons/hi";
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
  ci0: number[];
  scaledImpact: number[];
  scaledImpactAdjusted: number[];
  selected: boolean[];
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
}): React.ReactElement {
  const expRows: JSX.Element[] = [];

  // TODO inverse metrics!
  experimentImpactData.experiments.forEach((e) => {
    const variations: JSX.Element[] = [];
    const impacts: JSX.Element[] = [];
    e.experiment.variations.forEach((v, i) => {
      if (i === 0) {
        return;
      }

      if (experimentImpactType !== "other" && i !== e.keyVariationId) {
        return;
      }
      variations.push(
        <tr>
          <td>
            <div
              className={`variation variation${i} with-variation-label d-flex`}
            >
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
          </td>
        </tr>
      );
      impacts.push(
        <tr>
          <td>
            {e.impact?.scaledImpactAdjusted[i - 1] === undefined
              ? `N/A`
              : formatImpact(
                  e.impact?.scaledImpactAdjusted[i - 1] * 365,
                  formatter,
                  formatterOptions
                )}
            <span className="plusminus ml-1">
              ±
              {Math.abs(e.impact?.ci0[i - 1] ?? 0) === Infinity
                ? "∞"
                : formatter(
                    Math.abs(
                      ((e.impact?.scaledImpact[i - 1] ?? 0) -
                        (e.impact?.ci0[i - 1] ?? 0)) *
                        365
                    ),
                    formatterOptions
                  )}
            </span>
          </td>
        </tr>
      );
    });
    expRows.push(
      <tr key={e.experiment.id} className="hover-highlight">
        <td className="mb-1 ">
          <Link
            className="w-100 no-link-color"
            href={`/experiment/${e.experiment.id}`}
          >
            <strong>{e.experiment.name}</strong>{" "}
          </Link>
        </td>

        <td>
          {e.experiment.status === "stopped"
            ? date(
                e.experiment.phases[e.experiment.phases.length - 1].dateEnded ??
                  ""
              )
            : "N/A"}
        </td>
        <td>
          {e.experiment.results ? (
            <ResultsIndicator results={e.experiment.results} />
          ) : (
            <ExperimentStatusIndicator status={e.experiment.status} />
          )}
        </td>
        <td>
          <table>{variations}</table>
        </td>

        <td>
          <table>{impacts}</table>
        </td>
      </tr>
    );
  });
  return (
    <div className="col mb-3 bg-light">
      <div className="d-flex flex-row align-items-end">
        <span style={{ fontSize: "1.5em" }}>
          <span className="font-weight-bold">
            {experimentImpactData.experiments.length}
          </span>
          {" experiments were "}
          <span className="font-weight-bold">
            {experimentImpactType !== "other"
              ? `${experimentImpactType}s`
              : "inconclusive or are running"}
          </span>
        </span>
      </div>
      {experimentImpactType !== "other" ? (
        <div className="d-flex flex-row align-items-end">
          <span style={{ fontSize: "1.5em" }}>
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
            <HiOutlineExclamationCircle />
          </span>
        </div>
      ) : null}
      <div className="mt-3 p-3">
        <thead>
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
      </div>
    </div>
  );
}

export default function ExperimentImpact({
  experiments,
}: {
  experiments: ExperimentInterfaceStringDates[];
}): React.ReactElement {
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
  console.log(formatter);
  const formatterOptions: Intl.NumberFormatOptions = {
    currency: displayCurrency,
    notation: "compact",
    signDisplay: "never",
  };

  const exps = experiments
    .filter((e) => e.metrics.find((m) => m === metric))
    .sort(
      (a, b) =>
        getValidDate(
          b.phases[b.phases.length - 1].dateEnded ?? new Date()
        ).getTime() -
        getValidDate(
          a.phases[a.phases.length - 1].dateEnded ?? new Date()
        ).getTime()
    );

  useEffect(() => {
    const fetchSnapshots = async () => {
      const { snapshots } = await apiCall<{
        snapshots: ExperimentSnapshotInterface[];
      }>("/experiments/snapshots/scaled/", {
        method: "POST",
        body: JSON.stringify({
          ids: experiments.map((e) => e.id),
        }),
      });
      setSnapshots(snapshots);
      setLoading(false);
    };
    fetchSnapshots();
  }, [apiCall, experiments]);
  if (!snapshots && loading) {
    return <>Loading</>;
  }

  const experimentImpacts = new Map<string, ExperimentWithImpact>();

  const summaryObj: {
    winners: ExperimentImpactData;
    losers: ExperimentImpactData;
    others: ExperimentImpactData;
  } = {
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
          ci0: [],
          scaledImpact: [],
          scaledImpactAdjusted: [],
          selected: [],
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
              // TODO what if control is winner?
              const se = v?.metrics[metric]?.uplift?.stddev ?? 0;
              const impact = v?.metrics[metric]?.expected ?? 0;
              obj.scaledImpact.push(impact);
              allScaledImpacts.push(impact);
              obj.ci0.push(v?.metrics[metric]?.ci?.[0] ?? 0);
              obj.selected.push(e.winner === i);
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

    for (const e of experimentImpacts.values()) {
      let experimentImpact: number | null = null;
      let experimentAdjustedImpact: number | null = null;

      if (e.impact) {
        const adjustedImpacts: number[] = [];
        e.impact.scaledImpact.forEach((si, i) => {
          const adjustedImpact =
            adjustment.mean +
            (1 - adjustment.adjustment) * (si - adjustment.mean);
          e.impact?.scaledImpactAdjusted.push(adjustedImpact);
          adjustedImpacts.push(adjustedImpact);
          if (e.experiment.results === "won" && e.impact?.selected[i]) {
            e.keyVariationId = i + 1;
            experimentImpact = si;
            experimentAdjustedImpact = adjustedImpact;
          } else if (e.experiment.results === "lost") {
            // only include biggest loser for "savings"
            if (si < (experimentImpact ?? Infinity)) {
              e.keyVariationId = i + 1;
              experimentImpact = si;
              experimentAdjustedImpact = adjustedImpact;
            }
          }
        });
      }

      if (e.impact?.inSample) {
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
      <div className="appbox p-3 bg-light">
        <table className="impact-selector-table">
          <tr>
            <td>Metric</td>
            <td className="d-flex">
              <MetricSelector
                initialOption="None"
                value={metric}
                onChange={(metric) => form.setValue("metric", metric)}
                project={project ? project : undefined}
                includeFacts={true}
              />
            </td>
          </tr>
          <tr>
            <td>Project</td>
            <td className="d-flex">
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
            </td>
          </tr>
          <tr>
            <td>
              <span>Date</span>
            </td>
            <td>
              <div className="d-flex align-items-center ">
                <Field type="datetime-local" {...form.register("startDate")} />
                <div className="m-2">{" to "}</div>
                <Field type="datetime-local" {...form.register("endDate")} />
              </div>
            </td>
          </tr>
        </table>
      </div>
      {/* TODO null state when all arrays are empty */}
      <div>
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
            id={"summarys"}
            display={"Summary"}
            padding={false}
          >
            <div className="col mb-3 bg-light">
              <div className="row" style={{ fontSize: "1.5em" }}>
                <div className="col-auto mr-3 text-center">
                  <div className="d-flex mb-2 align-items-center justify-content-center">
                    <div
                      className={`badge-success rounded-circle mr-1`}
                      style={{ width: 10, height: 10 }}
                    />
                    <span className="font-weight-bold">Winners</span>
                  </div>
                  <div className="mb-2">
                    <span className="font-weight-bold">
                      {summaryObj.winners.experiments.length}
                    </span>
                    {" experiments"}
                  </div>

                  <div>
                    {formatImpact(
                      summaryObj.winners.totalAdjustedImpact * 365,
                      formatter,
                      formatterOptions
                    )}
                  </div>
                  <div className="text-muted">
                    {"summed impact per year "}
                    <HiOutlineExclamationCircle />
                  </div>
                </div>
                <div className="col-auto mr-3 text-center">
                  <div className="d-flex mb-2 align-items-center justify-content-center">
                    <div
                      className={`badge-danger rounded-circle mr-1`}
                      style={{ width: 10, height: 10 }}
                    />
                    <span className="font-weight-bold">Losers</span>
                  </div>

                  <div className="mb-2">
                    <span className="font-weight-bold">
                      {summaryObj.losers.experiments.length}
                    </span>
                    {" experiments"}
                  </div>

                  <div>
                    {formatImpact(
                      summaryObj.losers.totalAdjustedImpact * 365,
                      formatter,
                      formatterOptions
                    )}
                  </div>
                  <div className="text-muted">
                    {" summed saved impact per year"}
                    <HiOutlineExclamationCircle />
                  </div>
                </div>
                <div className="col-auto mr-3 text-center">
                  <div className="d-flex mb-2 align-items-center justify-content-center">
                    <div
                      className={`badge-secondary rounded-circle mr-1`}
                      style={{ width: 10, height: 10 }}
                    />
                    <span className="font-weight-bold">Others</span>
                  </div>

                  <div>
                    <span className="font-weight-bold">
                      {summaryObj.losers.experiments.length}
                    </span>
                    {" experiments"}
                  </div>
                </div>
              </div>
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
      </div>
    </div>
  );
}
