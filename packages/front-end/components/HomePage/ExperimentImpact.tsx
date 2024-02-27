import Link from "next/link";
import normal from "@stdlib/stats/base/dists/normal";
import React, { Fragment, useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ago, date, datetime, getValidDate } from "shared/dates";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import Collapsible from "react-collapsible";
import { FaArrowDown, FaArrowUp, FaPlus } from "react-icons/fa";
import { useRouter } from "next/router";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useCurrency } from "@/hooks/useCurrency";
import { formatNumber, getExperimentMetricFormatter } from "@/services/metrics";
import { Group } from "@visx/group";
import { Circle } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { ParentSizeModern } from "@visx/responsive";
import { GridColumns, GridRows } from "@visx/grid";
import { AxisBottom, AxisLeft } from "@visx/axis";
import MetricSelector from "../Experiment/MetricSelector";
import Field from "../Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { useForm } from "react-hook-form";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { phaseSummary } from "@/services/utils";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import { GBSuspicious } from "@/components/Icons";
import { HiOutlineExclamationCircle } from "react-icons/hi";

function jamesSteinAdjustment(effects: number[], se: number, useMean: boolean = false) {
  const Ne = effects.length;
  const priorMean = useMean ? effects.reduce((a, b) => a + b, 0) / Ne : 0;
  const adj = (Ne - 2) * Math.pow(se, 2) / effects.reduce((a, b) => a + Math.pow(b - priorMean, 2), 0);
  return {mean: priorMean, adjustment: adj};
}

function formatImpact(impact: number, formatter: (value: number, options?: Intl.NumberFormatOptions | undefined) => string, formatterOptions: Intl.NumberFormatOptions) {
 return (<><span className="expectedArrows">
                  {(impact > 0) ? (
                    <FaArrowUp />
                  ) : (impact < 0) ? (
                    <FaArrowDown />
                  ) : null}
                </span>{" "}
                <span className="expected bold">
                  {formatter(
                    impact,
                    {...formatterOptions, 
                      signDisplay: 'never'
                    }
                  )}
                </span></>)
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
  console.log(defaultStartDate)
  const form = useForm<ExperimentImpactFilters>({
    defaultValues: {
      startDate: defaultStartDate
      .toISOString()
      .substring(0, 16),
      endDate: now
      .toISOString()
      .substring(0, 16),
      project: "",
      metric: settings.northStar?.metricIds?.[0] ?? ""
    }
  });

  const { projects } = useDefinitions();

  const [snapshots, setSnapshots] = useState<ExperimentSnapshotInterface[]>();
  const [loading, setLoading] = useState(true);
  const { metrics, getFactTableById } = useDefinitions();
  const displayCurrency = useCurrency();

  const metric = form.watch("metric");

  const metricInterface = metrics.find((m) => m.id === metric);
  const formatter = metricInterface ? getExperimentMetricFormatter(metricInterface, getFactTableById, true) :
  formatNumber;
  console.log(formatter)
  const formatterOptions: Intl.NumberFormatOptions = {
    currency: displayCurrency,
    notation: "compact",
    signDisplay: 'never'
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
    impact?: ExperimentImpact; experiment: ExperimentInterfaceStringDates
  }
  const experimentImpacts = new Map<string, ExperimentWithImpact>();
  console.log(exps);
  let plot: JSX.Element | null = null;
  const expRows: JSX.Element[] = [];

  let totalImpact = 0;
  let totalAdjustedImpact = 0;
  let selected = 0;
  let numberExperiments = 0;
  let completedExperiments = 0;
  if (snapshots && exps) {
    let maxUnits = 0;
    let overallSE: number | null = null;
    let scaledImpacts: number[] = [];
    exps.forEach((e) => {
      const s = snapshots.find((s) => s.experiment === e.id);
      console.log(s)
      const ei: ExperimentWithImpact = {experiment: e};
      if (s) {
        const inSample = getValidDate(e.phases[e.phases.length - 1].dateEnded) > getValidDate(form.watch("startDate")) && getValidDate(e.phases[e.phases.length - 1].dateStarted) < getValidDate(form.watch("endDate"));
        if (inSample) {
          completedExperiments++;
        }
        const obj: ExperimentImpact = {
          endDate: s.settings.endDate,
          inSample: inSample,
          ci0: [],
          scaledImpact: [],
          scaledImpactAdjusted: [],
          scaledImpactSE: [],
          selected: [],
          units: []
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
              scaledImpacts.push(impact)
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
    console.log(displayCurrency)
    const adjustment = jamesSteinAdjustment(scaledImpacts, overallSE ?? 0);
    let data: {y: number, x: Date, status: string}[] = [];
   
    for (const [eid, e] of experimentImpacts.entries()) {
      if (e.impact) {
        const adjustedImpacts: number[] = [];
        e.impact.scaledImpact.forEach((si, i) => {
          const adjustedImpact = adjustment.mean + (1 - adjustment.adjustment) * (si - adjustment.mean);
          // if (si < minImpact) {
          //   minImpact = si;
          // }
          // if (si > maxImpact) {
          //   maxImpact = si;
          // }
          adjustedImpacts.push(adjustedImpact);
          if (e.impact?.selected[i] && e.impact?.inSample) {
            selected++;
            totalImpact += si;
            totalAdjustedImpact += adjustedImpact;
          }
          data.push({y: si, x: getValidDate(e.impact?.endDate), status: e.impact?.inSample ? (e.impact?.selected[i] ? "blue" : "black") : "gray"});
        });
        numberExperiments++;
        e.impact.scaledImpactAdjusted = adjustedImpacts;

        console.log(e.experiment.name)
        console.log(e.impact)
      }
      expRows.push(
         <tr key={eid} className="hover-highlight">
                    <td className="mb-1">
              <Link href={`/experiment/${eid}`}>
                <a className="w-100 no-link-color">
                      <strong>{e.experiment.name}</strong>{" "}

                </a>
              </Link>
                    </td>
                    <td>
                       <ExperimentStatusIndicator status={e.experiment.status} />
                       </td>
                      <td className="nowrap">
                      {e.experiment.status === "running"
                        ? "started"
                        : e.experiment.status === "stopped"
                        ? "ended"
                        : ""}{" "}
                      {ago((e.experiment.status === "running"
                        ? e.experiment.phases?.[e.experiment.phases?.length - 1]?.dateStarted
                        : e.experiment.status === "stopped"
                        ? e.experiment.phases?.[e.experiment.phases?.length - 1]?.dateEnded
                        : e.experiment.dateCreated) ?? new Date())}
                    </td>
                       <td className="nowrap" data-title="Summary:">
                      {e.experiment.status === "running" && e.experiment.phases[e.experiment.phases.length - 1] ? (
                        phaseSummary(e.experiment.phases[e.experiment.phases.length - 1])
                      ) : e.experiment.status === "stopped" && e.experiment.results ? (
                        <ResultsIndicator results={e.experiment.results} winnerIndex={e.experiment.winner} />
                      ) : (
                        ""
                      )}
                    </td>

                    <td>{formatter((e.impact?.units ?? []).reduce((sum, n) => sum + n, 0))}</td>
                        <td>
                          <table className="table-borderless table-sm"><tbody>
                    {e.experiment.variations.map((v, i) => {
                      if (i === 0) {
                        return null;
                      }
                      else return (
                      <tr>
                        <td>
                        <div
        className={`variation variation${i} with-variation-label d-flex align-items-center`}
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
        </span></div></td>
        <td>
                        {e.impact?.scaledImpact[i-1] === undefined ? `N/A` : formatImpact(e.impact?.scaledImpact[i-1], formatter, formatterOptions)}
                      </td><td><span className="plusminus ml-1">
                    ±
                    {Math.abs(e.impact?.ci0[i-1] ?? 0) === Infinity
                      ? "∞"
                      : formatter(
                          Math.abs(((e.impact?.scaledImpact[i-1] ?? 0) - (e.impact?.ci0[i-1] ?? 0))),
                          {...formatterOptions, signDisplay: 'never'}
                        )}
                  </span></td></tr>
                    )})}</tbody></table></td>
                  
          </tr>
        );
        }
  }
  return (
    <div>
       <div className="appbox p-3 bg-light table">
        <div className="row form-inline mb-1">
          <div className="col-auto">
            Metric:
          </div>
          <div className="col-auto">

          <MetricSelector
            initialOption="None"
            value={metric}
            onChange={(metric) => form.setValue("metric", metric)}
            includeFacts={true}
          /></div>
          </div>
          <div className="row form-inline mb-1">
          <div className="col-auto">
            Project:
          </div>
          <div className="col-auto">
          <SelectField
            value={form.watch("project")}
            options={[
              {value: "", label: "All"},
              ...projects.map((p) => ({value: p.id, label: p.name}))
            ]}
            onChange={(v) => form.setValue("project", v)}
            />
        </div>
</div>
        <div className="row align-items-center">
        <div className="col-auto form-inline">
        <span>
            Experiment latest phase running between{"  "}
          </span>
          <div className="col-auto form-inline">
          <Field
              type="datetime-local"
              {...form.register("startDate")}
            />
            </div>
            <span>{"and"}</span>

          <div className="col-auto form-inline">
          <Field
              type="datetime-local"
              {...form.register("endDate")}
            />
            </div>
        </div>
      </div>
      </div>
      {/* <div>
                    {plot}
          </div> */}
           <div>

  
          <div className="d-flex flex-row align-items-end mb-1">
          <span style={{ fontSize: "1.5em" }}><span className="font-weight-bold">{selected}</span>{" experiments with Metric "}<Fragment key={'frag'}><code>{metricInterface.name}</code></Fragment> had a variation marked as a winner.
          </span></div>
          <div className="d-flex flex-row align-items-end">
          <span style={{ fontSize: "1.5em" }}>{`The summed impact of these winning variations is `}{(totalAdjustedImpact > 0) ? (
                    <FaArrowUp />
                  ) : (totalAdjustedImpact < 0) ? (
                    <FaArrowDown />
                  ) : null}<span className="font-weight-bold">{formatter(totalAdjustedImpact * 365, formatterOptions)}</span>{` per year. `}<HiOutlineExclamationCircle />
          </span></div>
          
        <div className="px-3 py-3 row align-items-top">
                <div className="col-auto text-center pr-5">
                  <div className="row">
                    <div className="col text-center ">
                    <h5>Experiments</h5>
                    </div>
                  </div>
                  <div className="row">
                    <span className="text-muted">Total:</span>{numberExperiments}
                  </div>
                  <div className="row">
                  <span className="text-muted">Completed:</span>{completedExperiments}
                  </div>
                  <div className="row">
                  <span className="text-muted">With Winner:</span>{selected}</div>
                  </div>
                <div className="col-auto text-center">
                  <div className="row">
                    <div className="col text-center">
                      <h5>Total Scaled Impact of Winners</h5>
                    </div>
                  </div>
                  <div className="row">
                  <div className="col-auto">
                  <span className="text-muted">Simple Sum:</span>{formatImpact(totalImpact*365, formatter, formatterOptions)}
                  </div>
                  <div className="col-auto">
                  <span className="text-muted">Adjusted Sum:</span>{formatImpact(totalAdjustedImpact*365, formatter, formatterOptions)}
                  </div>
                  </div>
                  </div>
                  
                </div>
            </div>
            
        <table className="table">
        <thead>
              <tr>
                <th>
                  Experiment
                </th>
                <th>Status</th>
                <th>Date</th>
                <th>Summary</th>
                <th>Total Units</th>
                <th>Scaled Impact</th>
              </tr>
            </thead><tbody>{expRows}</tbody></table>
      
    </div>
  );
}
