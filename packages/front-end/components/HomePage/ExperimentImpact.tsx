import Link from "next/link";
import normal from "@stdlib/stats/base/dists/normal";
import React, { useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { date } from "shared/dates";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import Collapsible from "react-collapsible";
import { FaPlus } from "react-icons/fa";
import { useRouter } from "next/router";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { phaseSummary } from "@/services/utils";
import { useUser } from "@/services/UserContext";
import SortedTags from "../Tags/SortedTags";
import SelectField from "../Forms/SelectField";
import { useCurrency } from "@/hooks/useCurrency";
import { formatNumber, getExperimentMetricFormatter } from "@/services/metrics";
import ResultsIndicator from "../Experiment/ResultsIndicator";
import ExperimentStatusIndicator from "../Experiment/TabbedPage/ExperimentStatusIndicator";
import { Group } from "@visx/group";
import { Circle } from "@visx/shape";
import { scaleLinear } from "@visx/scale";
import { ParentSizeModern } from "@visx/responsive";
import { GridColumns } from "@visx/grid";
import { AxisBottom } from "@visx/axis";

type group = "project" | "tag";

const noneString = "%__none__%";
const scaledImpactFormatter = Intl.NumberFormat(undefined, {
  notation: "compact"
})

export default function ExperimentImpact({
  experiments,
}: {
  experiments: ExperimentInterfaceStringDates[];
}): React.ReactElement {
  const settings = useOrgSettings();
  const [metric, setMetric] = useState(
    settings.northStar?.metricIds?.[0] ?? ""
  );
  const [group, setGroup] = useState<group>("project");
  const [snapshots, setSnapshots] = useState<ExperimentSnapshotInterface[]>();
  const [loading, setLoading] = useState(true);
  const { metrics, getFactTableById } = useDefinitions();
  const { getUserDisplay } = useUser();
  const router = useRouter();

  const displayCurrency = useCurrency();

  const metricInterface = metrics.find((m) => m.id === metric);
  const formatter = metricInterface ? getExperimentMetricFormatter(metricInterface, getFactTableById, true) :
  formatNumber;
  const formatterOptions: Intl.NumberFormatOptions = {
    currency: displayCurrency,
    notation: "compact"
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
    controlUnits: number;
    scaledImpact: number[];
    scaledImpactSE: number[];
    units: number[];
    selected: boolean[];
  };
  type OverallImpact = {
    uniqueExperiments: string[];
    experiments: string[];
    effects: number[];
    ses: number[];
    units: number[];
    selected: boolean[];
  };
  type ImpactAnalysis = {
    all: OverallImpact;
    groups: Map<string, OverallImpact>;
  };

  const experimentImpacts = new Map<
    string,
    { impact: ExperimentImpact; experiment: ExperimentInterfaceStringDates }
  >();
  const impactAnalyses: ImpactAnalysis = {
    all: {
      uniqueExperiments: [],
      experiments: [],
      effects: [],
      ses: [],
      units: [],
      selected: [],
    },
    groups: new Map<string, OverallImpact>(),
  };

  if (snapshots && exps) {
    exps.forEach((e) => {
      const s = snapshots.find((s) => s.experiment === e.id);

      const obj: ExperimentImpact = {
        controlUnits: 0,
        scaledImpact: [],
        scaledImpactSE: [],
        selected: [],
        units: []
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
          // no dim so always one row:
          const res = scaledAnalysis.results[0];
          res.variations.forEach((v, i) => {
            if (i === 0) {
              obj.controlUnits = v.users;
            }
            // TODO what if control is winner?
            else {
              // TODO effect of adding all branches?
              obj.scaledImpact.push(v?.metrics[metric]?.expected ?? 0);
              obj.scaledImpactSE.push(v?.metrics[metric]?.uplift?.stddev ?? 0);
              obj.selected.push(e.winner === i);
              obj.units.push(v.users);
            }
          });
        }

        let groups = e.project ? [e.project] : [noneString];
        if (group === "tag") {
          groups = e.tags.length ? e.tags : [noneString];
        }
        //const project = e.project || "%__none__%";
        impactAnalyses.all.uniqueExperiments.push(e.id);
        impactAnalyses.all.experiments = impactAnalyses.all.experiments.concat(
          Array(obj.scaledImpact.length).fill(e.id)
        );
        impactAnalyses.all.effects = impactAnalyses.all.effects.concat(
          obj.scaledImpact
        );
        impactAnalyses.all.ses = impactAnalyses.all.ses.concat(
          obj.scaledImpactSE
        );
        impactAnalyses.all.units = impactAnalyses.all.units.concat(
          obj.units.map((u) => u + obj.controlUnits)
        )
        impactAnalyses.all.selected = impactAnalyses.all.selected.concat(
          obj.selected
        );
        groups.forEach((g) => {
          const analysis = impactAnalyses.groups.get(g);
          if (analysis) {
            analysis.uniqueExperiments.push(e.id);
            analysis.experiments = analysis.experiments.concat(
              Array(obj.scaledImpact.length).fill(e.id)
            );
            analysis.effects = analysis.effects.concat(obj.scaledImpact);
            analysis.ses = analysis.ses.concat(obj.scaledImpactSE);
            analysis.selected = analysis.selected.concat(obj.selected);
          } else {
            impactAnalyses.groups.set(g, {
              uniqueExperiments: [e.id],
              experiments: Array(obj.scaledImpact.length).fill(e.id),
              effects: obj.scaledImpact,
              ses: obj.scaledImpactSE,
              units: obj.units.map((u) => u + obj.controlUnits),
              selected: obj.selected,
            });
          }
        });
      }
      experimentImpacts.set(e.id, { impact: obj, experiment: e });
    });
  }
  const impacts: React.ReactElement[] = [];
  impactAnalyses.groups.forEach((value, key) => {
    // let selected = 0;
    // let impact = 0;
    // let bias = 0;
    // TODO just get SE above
    const se = value.ses[value.units.indexOf(Math.max(...value.units)) ?? 0]
    const adj = (value.effects.length  - 2) * Math.pow(se, 2) / value.effects.reduce((a, b) => a + Math.pow(b, 2), 0);
    const adjEstimates = value.effects.map((e) => e * adj);
    const selected = value.selected.filter((s) => s).length;
    const impact = value.effects.filter((_, i) => value.selected[i]).reduce((a, b) => a + b, 0);
    const adjImpact = adjEstimates.filter((_, i) => value.selected[i]).reduce((a, b) => a + b, 0);
    //value.effects.forEach((e, i) => {
      // console.log("numbers")
      // console.log(se);
      // console.log(e);
      // console.log((se * 0.6744897501960817 - e) / se);
      // bias += (se === 0 ? 0 : se * normal.pdf((se * 0.6744897501960817 - e) / se, 0, 1));
    //});
    //     <div className="px-3 py-3 row  text-dark">
    // <div className="col-auto d-flex align-items-center  text-dark">
    // <div>{key},</div>
    //   <div>{value.uniqueExperiments.length},</div>
    //   <div>{selected},</div>
    //   <div>{impact},</div>
    //   <div>{impact - bias}</div>
    //   <FaAngleRight className="chevron" />
    //   </div>
    //   </div>

    const min = Math.min(...value.effects);
    const max = Math.max(...value.effects);
    const data1 = value.effects.map((e, i) => {
      return { x: e, y: Math.random() / 10 };
    });

    const accessors = {
      xAccessor: (d) => d.x,
      yAccessor: (d) => d.y,
    };
    impacts.push(<>
      <div className="border bg-light my-2">
        <div className="px-3 py-3 row align-items-center">
                  <div className="w-20">{group.toLocaleUpperCase()}: {key}</div>
                  <div className="w-25 align-items-center">
                    <div className="text-center">Total Experiments:</div>
                    <div className="text-center">Experiments</div>
                    <div className="text-center">Completed: {value.uniqueExperiments.length} Launched: {selected}</div>
                  </div>
                  <div className="w-25 align-items-center">
                    <div className="text-center">Summed Scaled Impact</div>
                    <div className="text-center">{formatter(impact, formatterOptions)}</div>
                  </div>
                  <div className="w-25 align-items-center">
                    <div className="text-center">Adjusted Scaled Impact</div>
                    <div className="text-center">{formatter(adjImpact, formatterOptions)}</div>
                  </div>
                  
            </div>
            <ParentSizeModern style={{ position: "relative" }}>
        {({ width }) => {
          const height = 50;
          const yMax = height;
          const xMax = width;
          const graphHeight = yMax;
          const margin = [-20, -30, -30, -30];

          // TODO always include 0
          const xScale = scaleLinear({
            domain: [min, max],
            range: [0, xMax],
            round: true,
          });
          const yScale = scaleLinear<number>({
            domain: [-0.1, 1.2],
            range: [graphHeight, 0],
            round: true,
          });


          const numXTicks = 10;

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
                {data1.map((d, i) => <Circle key={i} cx={xScale(d.x)} cy={yScale(d.y)} r={5} fill="black" />)}
                <AxisBottom
                  top={yMax}
                  scale={xScale}
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
  });
  return (
    <div>
      <div className="d-flex w-100">
        <div className="mb-2 mx-2 form-inline">
        <span>
            Metric:{" "} {/*TODO METRIC SELECTOR*/}
          </span>
          <SelectField
            value={metric}
            onChange={(m) => setMetric(m)}
            options={metrics.map((m) => {
              return {
                value: m.id,
                label: m.name,
              };
            })}
          />
        </div>
        <div className="mb-2 mx-2 form-inline">
        <span>
            Group By:{" "}
          </span>
          <SelectField
            value={group}
            onChange={(g) => setGroup(g as group)}
            options={[
              {value: "project",
            label: "Project"},
            {value: "tag",
            label: "Tag"}
            ]
            }
          />
        </div>
        <div className="mb-3">
          {/* TODO actually put in date picker*/}
        </div>
      </div>
      <div>
                    {impacts}
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
