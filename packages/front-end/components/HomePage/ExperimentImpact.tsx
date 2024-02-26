import Link from "next/link";
import normal from "@stdlib/stats/base/dists/normal";
import React, { useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { date, getValidDate } from "shared/dates";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import Collapsible from "react-collapsible";
import { FaPlus } from "react-icons/fa";
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


type group = "project" | "tag";

const noneString = "%__none__%";
const scaledImpactFormatter = Intl.NumberFormat(undefined, {
  notation: "compact"
})

function jamesSteinAdjustment(effects: number[], se: number) {
  const Ne = effects.length;
  const mean = effects.reduce((a, b) => a + b, 0) / Ne;
  const adj = (Ne - 2) * Math.pow(se, 2) / effects.reduce((a, b) => a + Math.pow(b - mean, 2), 0);
  return {mean: mean, adjustment: adj};
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
  const formatterOptions: Intl.NumberFormatOptions = {
    currency: displayCurrency,
    notation: "compact"
  };

  const { apiCall } = useAuth();

  const exps = experiments.filter((e) => {
    if (e.phases[e.phases.length - 1]?.dateEnded !== undefined) {
      return e.metrics.find((m) => m === metric) && new Date(e.phases[e.phases.length - 1].dateEnded) < getValidDate(form.watch("endDate")) && new Date(e.phases[e.phases.length - 1].dateEnded) > getValidDate(form.watch("startDate"));
    }
    return false;
  });
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
  if (snapshots && exps) {
    let maxUnits = 0;
    let overallSE: number | null = null;
    let scaledImpacts: number[] = [];
    exps.forEach((e) => {
      const s = snapshots.find((s) => s.experiment === e.id);
      console.log(s)
      const ei: ExperimentWithImpact = {experiment: e};
      if (s) {
        const obj: ExperimentImpact = {
          endDate: s.settings.endDate,
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

    let minImpact = 0;
    let maxImpact = 0;
    let totalImpact = 0;
    let totalAdjustedImpact = 0;
    let selected = 0;
    let experiments = 0;
    let data: {y: number, x: Date}[] = [];
    for (const [eid, e] of experimentImpacts.entries()) {
      if (e.impact) {
        const adjustedImpacts: number[] = [];
        e.impact.scaledImpact.forEach((si, i) => {
          const adjustedImpact = adjustment.mean + adjustment.adjustment * (si - adjustment.mean);
          if (si < minImpact) {
            minImpact = si;
          }
          if (si > maxImpact) {
            maxImpact = si;
          }
          adjustedImpacts.push(adjustedImpact);
          if (e.impact?.selected[i]) {
            selected++;
            totalImpact += si;
            totalAdjustedImpact += adjustedImpact;
          }
          data.push({y: si, x: e.impact?.endDate ?? new Date()});
        });
        experiments++;
        e.impact.scaledImpactAdjusted = adjustedImpacts;
      }
    }

    const accessors = {
      xAccessor: (d) => d.x,
      yAccessor: (d) => d.y,
    };
    console.log(data);
      // Get x-axis domain
    const min = Math.min(...data.map((d) => new Date(d.x).getTime()));
    const max = Math.max(...data.map((d) => new Date(d.x).getTime()));
    console.log(min);
    console.log(max);
    plot = (<>
      <div>
        <div className="px-3 py-3 row align-items-center">
                  <div className="w-25 align-items-center">
                    <div className="text-center">Total Experiments:</div>
                    <div className="text-center">Experiments</div>
                    <div className="text-center">Completed: {experiments} Launched: {selected}</div>
                  </div>
                  <div className="w-25 align-items-center">
                    <div className="text-center">Summed Scaled Impact</div>
                    <div className="text-center">{formatter(totalImpact, formatterOptions)}</div>
                  </div>
                  <div className="w-25 align-items-center">
                    <div className="text-center">Adjusted Scaled Impact</div>
                    <div className="text-center">{formatter(totalAdjustedImpact, formatterOptions)}</div>
                  </div>
                  
            </div>
            <ParentSizeModern style={{ position: "relative" }}>
        {({ width }) => {
          const margin = [15, 15, 50, 80];
          const height = 200;
          const yMax = height - margin[0] - margin[2];
          const xMax = width - margin[1] -  margin[3];

          // TODO always include 0
          const yScale = scaleLinear<number>({
            domain: [minImpact, maxImpact],
            range: [yMax, 0],
            round: true,
          });
          const xScale = scaleTime({
            domain: [min, max],
            range: [0, xMax],
            round: true,
          });


          const numXTicks = 10;
          console.log(data);
          return (
            <>
              <svg width={width} height={height}>
              <Group left={margin[3]} top={margin[0]}>
                <GridColumns
                  scale={xScale}
                  numTicks={numXTicks}
                  stroke="var(--border-color-200)"
                  height={yMax}
                />
                <GridRows
                  scale={yScale}
                  width={xMax}
                  stroke="var(--border-color-200)"
                />
                {data.map((d, i) => <Circle key={i} cx={xScale(d.x)} cy={yScale(d.y)} r={5} fill="black" />)}
                <AxisBottom
                  top={yMax}
                  scale={xScale}
                  tickLength={5}
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 11,
                    textAnchor: "middle",
                  })}
                  label={"Experiment End Date"}
                  labelClassName="h5"
                />
                <AxisLeft
                  scale={yScale}
                  tickLength={5}
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 11,
                    textAnchor: "middle",
                  })}
                  label={"Scaled Impact"}
                  labelClassName="h5"
                />
              </Group>
              </svg>
            </>
          );
        }}
      </ParentSizeModern>

          </div>
  </>);
  }
  console.log(form.watch("startDate"))
  return (
    <div>
      <div className="row align-items-center p-3">
        <div className="col-auto form-inline">
        <div className="uppercase-title text-muted">Metric</div>
        <div>
          <MetricSelector
            initialOption="None"
            value={metric}
            onChange={(metric) => form.setValue("metric", metric)}
            includeFacts={true}
          />
        </div>
        </div>
        <div className="col-auto form-inline">
        <span>
            Project:{" "}
          </span>
          <SelectField
            value={form.watch("project")}
            containerClassName={"select-dropdown-underline"}
            options={[
              {value: "", label: "All"},
              ...projects.map((p) => ({value: p.id, label: p.name}))
            ]}
            onChange={(v) => form.setValue("project", v)}
            />
        </div>
        <div className="col-auto form-inline">
        <span>
            Experiment end date between{"  "}
          </span>
          <Field
              type="datetime-local"
              {...form.register("startDate")}
            />
            <span>{"and"}</span>
          <Field
              type="datetime-local"
              {...form.register("endDate")}
            />
        </div>
      </div>
      <div>
                    {plot}
          </div>
      {/*<ul className="list-unstyled simple-divider ">
       {exps.map((test, i) => {
        // get start and end dates by looking for min and max start dates of main and rollup phases
        let startDate = test.dateCreated,
          endDate;

        test.phases.forEach((p) => {
          if (
            !startDate ||
            getValidDate(p?.dateStarted ?? "") < getValidDate(startDate)
          ) {
            startDate = p.dateStarted ?? "";
          }
          if (
            !endDate ||
            getValidDate(p?.dateEnded ?? "") > getValidDate(endDate)
          )
            endDate = p.dateEnded;
        });
        const currentPhase = test.phases[test.phases.length - 1];
        return (
          <li key={i} className="w-100 hover-highlight">
            <div key={test.id} className="d-flex">
              <Link href={`/experiment/${test.id}`}>
                <a className="w-100 no-link-color">
                  <div className="d-flex w-100">
                    <div className="mb-1">
                      <strong>{test.name}</strong>{" "}
                    </div>
                    <div style={{ flex: 1 }} />
                    {
                      analysisMap[test.id] ?
                      <>

<div className="">
                        <span>
                          { test.status}
                        </span>
                      </div>
                    <div style={{ flex: 1 }} />
                        <div className="">
                        <span>
                          { analysisMap[test.id].totalUnits}
                        </span>
                      </div>
                    <div style={{ flex: 1 }} />1
                      <div className="">
                        <span>
                          {analysisMap[test.id].scaledImpact}
                        </span>
                      </div></>
                    : <></>
                    }
                    
                  </div>
                </a>
              </Link>
            </div>
          </li>
        );
      })} 
    </ul>*/}
    </div>
  );
}
