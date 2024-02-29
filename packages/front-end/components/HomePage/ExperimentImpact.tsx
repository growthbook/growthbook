import Link from "next/link";
import React, { useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { getValidDate } from "shared/dates";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { FaArrowDown, FaArrowUp, FaPlus } from "react-icons/fa";
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
import Field from "../Forms/Field";
import MetricSelector from "../Experiment/MetricSelector";
import { capitalizeFirstLetter } from "@/services/utils";

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

type ExperimentImpact = {
  endDate: Date;
  inSample: boolean;
  ci0: number[];
  scaledImpact: number[];
  scaledImpactAdjusted: number[];
  scaledImpactSE: number[];
  units: number[];
  selected: boolean[];
};

type ExperimentWithImpact = {
  keyVariationId?: number;
  impact?: ExperimentImpact;
  summary: ExperimentSummary;
  experiment: ExperimentInterfaceStringDates;
};

type ExperimentSummary = "summary" | "winner" | "loser" | "other";

type ExperimentSummaryData =  {
  totalImpact: number,
  totalAdjustedImpact: number,
  experiments: ExperimentWithImpact[],
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

function ImpactCard({
  experimentSummaryData,
  experimentSummaryType,
  formatter,
  formatterOptions,
}: {
  experimentSummaryData: ExperimentSummaryData;
  experimentSummaryType: ExperimentSummary;
  formatter: (
    value: number,
    options?: Intl.NumberFormatOptions | undefined
  ) => string;
  formatterOptions: Intl.NumberFormatOptions
}): React.ReactElement {
  const expRows: JSX.Element[] = [];

  // TODO inverse metrics!
  experimentSummaryData.experiments.forEach((e) => {

    let variations: JSX.Element[] = [];
    e.experiment.variations.forEach((v, i) => {
      if (i === 0) {
        return;
      }

      if (experimentSummaryType !== "other" && i !== e.keyVariationId) {
        return;
      }
      variations.push(<tr><td>
              <div
                className={`variation variation${i} with-variation-label d-flex align-items-center`}
              >
                <span
                  className="label"
                  style={{ width: 20, height: 20 }}
                >
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
              </div></td>
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
              </span></td>
              </tr>);
          });
    expRows.push(
      <tr key={e.experiment.id} className="hover-highlight">
        <td className="mb-1 ">
          <Link href={`/experiment/${e.experiment.id}`}>
            <a className="w-100 no-link-color">
              <strong>{e.experiment.name}</strong>{" "}
            </a>
          </Link>
        </td>

        {experimentSummaryType === "other" ? (<td>
          
          <ExperimentStatusIndicator status={e.experiment.status} />
          {e.experiment.results ? <ResultsIndicator results={e.experiment.results} /> : null}
          </td>): null}
        <td>

        <table className="table-compact"><tbody>
          {variations}
        </tbody></table>
        </td>

        
      </tr>
    );
  })
  return (
    <div className="col mb-3 bg-light">
    <div className="d-flex flex-row align-items-end">
          <span style={{ fontSize: "1.5em" }}><span className="font-weight-bold">{experimentSummaryData.experiments.length}</span>{" experiments were "}<span className="font-weight-bold">{experimentSummaryType}s</span>
          </span></div>
          <div className="d-flex flex-row align-items-end">
          <span style={{ fontSize: "1.5em" }}>{formatImpact(experimentSummaryData.totalAdjustedImpact*365, formatter, formatterOptions)}{` per year is the summed impact of the winning variations. `}<HiOutlineExclamationCircle />
          </span></div>
    <div className="table-small table-responsive mt-3 p-3">
      <thead>
        <tr>
          <th>Experiment</th>
          {experimentSummaryType === "other" ? <th>Status</th> : null}
          <th>Scaled Impact</th>
        </tr>
      </thead>
      <tbody>{expRows}</tbody>
    </div>
</div>);
}

type ExperimentImpactFilters = {
  startDate: string;
  endDate: string;
  project: string;
  metric: string;
};

export default function ExperimentImpact({
  experiments,
}: {
  experiments: ExperimentInterfaceStringDates[];
}): React.ReactElement {
  const settings = useOrgSettings();
  const now = new Date();
  const defaultStartDate = new Date(now);
  defaultStartDate.setDate(defaultStartDate.getDate() - 180);
  console.log(defaultStartDate);
  const form = useForm<ExperimentImpactFilters>({
    defaultValues: {
      startDate: defaultStartDate.toISOString().substring(0, 16),
      endDate: now.toISOString().substring(0, 16),
      project: "",
      metric: settings.northStar?.metricIds?.[0] ?? "",
    },
  });

  const [experimentStatus, setExperimentStatus] = useState<ExperimentSummary>(
    "summary"
  );

  const { projects } = useDefinitions();

  const [snapshots, setSnapshots] = useState<ExperimentSnapshotInterface[]>();
  const [loading, setLoading] = useState(true);
  const { metrics, getFactTableById } = useDefinitions();
  const displayCurrency = useCurrency();

  const metric = form.watch("metric");

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

  const { apiCall } = useAuth();

  const exps = experiments.filter((e) => e.metrics.find((m) => m === metric));

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
  console.log(exps);

  const summaryObj:  {winners: ExperimentSummaryData, losers: ExperimentSummaryData, others: ExperimentSummaryData} = {
    winners: {
      totalAdjustedImpact: 0,
      totalImpact: 0,
      experiments: []
    },
    losers: {
      totalAdjustedImpact: 0,
      totalImpact: 0,
      experiments: []
    },
    others: {
      totalAdjustedImpact: 0,
      totalImpact: 0,
      experiments: []
    }
  };
  if (snapshots && exps) {
    const maxUnits = 0;
    let overallSE: number | null = null;
    const scaledImpacts: number[] = [];
    exps.forEach((e) => {
      const s = snapshots.find((s) => s.experiment === e.id);
      console.log(s);
      const inSample =
        !!s &&
        getValidDate(e.phases[e.phases.length - 1].dateEnded) >
          getValidDate(form.watch("startDate")) &&
        getValidDate(e.phases[e.phases.length - 1].dateStarted) <
          getValidDate(form.watch("endDate"));
          
      const summary = (inSample && e.results === "won" && !!e.winner) ? "winner" : ( inSample && e.results === "lost") ? "loser": "other";
      const ei: ExperimentWithImpact = { experiment: e, summary: summary};
      if (s) {
        const obj: ExperimentImpact = {
          endDate: s.settings.endDate,
          inSample: inSample,
          ci0: [],
          scaledImpact: [],
          scaledImpactAdjusted: [],
          scaledImpactSE: [],
          selected: [],
          units: [],
        };
        const defaultSettings = getSnapshotAnalysis(s)?.settings;
        const scaledAnalysis = defaultSettings
          ? getSnapshotAnalysis(s, {
              ...defaultSettings,
              differenceType: "scaled",
            })
          : null;

        if (scaledAnalysis && scaledAnalysis.results.length) {
          // no dim so always one row:
          const res = scaledAnalysis.results[0];
          res.variations.forEach((v, i) => {
            if (i !== 0) {
              // TODO what if control is winner?
              // TODO effect of adding all branches?
              const se = v?.metrics[metric]?.uplift?.stddev ?? 0;
              const impact = v?.metrics[metric]?.expected ?? 0;
              obj.scaledImpact.push(impact);
              scaledImpacts.push(impact);
              obj.scaledImpactSE.push(se);
              obj.ci0.push(v?.metrics[metric]?.ci?.[0] ?? 0);
              obj.selected.push(e.winner === i);
              const totalUnits = v.users + res.variations[0].users;
              if (totalUnits > maxUnits && se > 0) {
                overallSE = se;
              }
              obj.units.push(v.users + res.variations[0].users);
            }
          });
        }
        ei.impact = obj;
      }
      experimentImpacts.set(e.id, ei);
    });

    const adjustment = jamesSteinAdjustment(scaledImpacts, overallSE ?? 0);
    
    for (const [eid, e] of experimentImpacts.entries()) {
      
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
            e.keyVariationId = i+1;
            experimentImpact = si;
            experimentAdjustedImpact = adjustedImpact
          } else if (e.experiment.results === "lost") {
            // only include biggest loser for "savings"
            if (si < (experimentImpact ?? Infinity)) {
              e.keyVariationId = i+1;
              experimentImpact = si;
              experimentAdjustedImpact = adjustedImpact;
            }
          }
      });
    }
    if (e.experiment.results === "won") {
      summaryObj.winners.totalImpact += experimentImpact ?? 0;
      summaryObj.winners.totalAdjustedImpact += experimentAdjustedImpact ?? 0;
      summaryObj.winners.experiments.push(e);
    } else if (e.experiment.results === "lost") {
      summaryObj.losers.totalImpact += experimentImpact ?? 0;
      summaryObj.losers.totalAdjustedImpact += experimentAdjustedImpact ?? 0;
      summaryObj.losers.experiments.push(e);
    } else {
      summaryObj.others.experiments.push(e);
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
              includeFacts={true}
            />
          </td>
        </tr>
        <tr>
          <td>Project</td>
          <td className="d-flex">
            <SelectField
              value={form.watch("project")}
              options={[
                { value: "", label: "All" },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
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
      <div>
        
      <ControlledTabs
          setActive={(s) => {
            setExperimentStatus((s as ExperimentSummary) || "winner");
          }}
          active={experimentStatus}
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
    <div className="d-flex flex-row align-items-end">
      <table className="table"><tbody>
        <tr>
          <td>
            Winners
          </td>

          <td>
            <span className="font-weight-bold">{summaryObj.winners.experiments.length}</span>{" experiments"}
          </td>

          <td>
            {formatImpact(summaryObj.winners.totalAdjustedImpact*365, formatter, formatterOptions)}{" per year summed impact"}
          </td>
        </tr>
        <tr>
          <td>
            Losers
          </td>

          <td>
            <span className="font-weight-bold">{summaryObj.losers.experiments.length}</span>{" experiments"}
          </td>

          <td>
            {formatImpact(summaryObj.losers.totalAdjustedImpact*-365, formatter, formatterOptions)}{" per year summed saved impact"}
          </td>
        </tr>
        <tr>
          <td>
            Others (running, inconclusive)
          </td>

          <td>
            <span className="font-weight-bold">{summaryObj.losers.experiments.length}</span>{" experiments"}
          </td>
          <td></td>
        </tr>
        </tbody></table>
      </div>
      </div>
          </Tab>
          <Tab
            key={"winner"}
            id={"winner"}
            display={"Winners"}
            padding={false}
          >
            <ImpactCard
              experimentSummaryData={summaryObj.winners}
              experimentSummaryType={"winner"}
              formatter={formatter}
              formatterOptions={formatterOptions}
            />
          </Tab>
          <Tab
            key={"loser"}
            id={"loser"}
            display={"Losers"}
            padding={false}
          >
            <ImpactCard
              experimentSummaryData={summaryObj.losers}
              experimentSummaryType={"loser"}
              formatter={formatter}
              formatterOptions={formatterOptions}
            />
            </Tab>

          <Tab
            key={"other"}
            id={"other"}
            display={"Others"}
            padding={false}
          >
            <ImpactCard
              experimentSummaryData={summaryObj.others}
              experimentSummaryType={"other"}
              formatter={formatter}
              formatterOptions={formatterOptions}
            />
          </Tab>
          </ControlledTabs>
      </div>
    </div>
  );
}
