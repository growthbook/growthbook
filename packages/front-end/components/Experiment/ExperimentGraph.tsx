import React, { useCallback, useMemo, useState } from "react";
import { BarRounded, BarStack } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { ParentSizeModern } from "@visx/responsive";
import { scaleBand, scaleLinear } from "@visx/scale";
import { GridRows } from "@visx/grid";
import format from "date-fns/format";
import { TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { getValidDate } from "shared/dates";
import { Parser } from "json2csv";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import SelectField from "@/components/Forms/SelectField";
import LoadingOverlay from "@/components/LoadingOverlay";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import styles from "./ExperimentGraph.module.scss";

export default function ExperimentGraph({
  resolution = "month",
  num = 12,
  title = "Experiments by month",
  height = 250,
  initialShowBy = "all",
}: {
  resolution?: "month" | "day" | "year";
  num?: number;
  title?: string;
  height?: number;
  initialShowBy?: "status" | "project" | "results" | "user" | "all";
}): React.ReactElement {
  const { project, projects } = useDefinitions();
  const [showBy, setShowBy] = useState<
    "status" | "project" | "all" | "results" | "user"
  >(initialShowBy);
  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<Record<string, number | string>>();

  let stackedKeys: string[] = [];
  const getGraphColor = (key: string) => {
    if (showBy === "results") {
      return `var(--results-${key})`;
    }
    if (showBy === "status") {
      return `var(--status-${key})`;
    }
    return "var(--graph-color-" + ((stackedKeys.indexOf(key) % 17) + 1) + ")";
  };

  const showSelectOptions = [
    {
      value: "all",
      label: "All experiments",
    },
    {
      value: "status",
      label: "By status",
    },
    {
      value: "results",
      label: "By results",
    },
  ];
  // have a dropdown for projects doesn't make sense when viewing just one project
  if (!project) {
    showSelectOptions.push({
      value: "project",
      label: "By projects",
    });
  }

  const { data, error } = useApi<{
    all: { date: string; numExp: number }[];
    byStatus: {
      draft: { date: string; numExp: number }[];
      running: { date: string; numExp: number }[];
      stopped: { date: string; numExp: number }[];
    };
    byProject: Record<string, { date: string; numExp: number }[]>;
    byResults: {
      won: { date: string; numExp: number }[];
      lost: { date: string; numExp: number }[];
      dnf: { date: string; numExp: number }[];
      inconclusive: { date: string; numExp: number }[];
    };
  }>(`/experiments/frequency/${resolution}/${num}?project=${project}`);

  const projectMap = useMemo(() => {
    const pMap = new Map();
    projects.forEach((p) => {
      pMap.set(p.id, p.name);
    });
    pMap.set("all", "All projects");
    return pMap;
  }, [projects]);

  const parseDataForCSV = useCallback(
    (type) => {
      if (type === "all") {
        const monthData: { date: string; experiments: number }[] = [];
        if (data && "all" in data) {
          data.all.forEach((a) => {
            monthData.push({ date: a.date, experiments: a.numExp });
          });
        }
        return monthData;
      } else if (type === "projects") {
        const projectData = data?.byProject || null;
        if (!projectData) return [];
        const allDates = projectData.all.map((p) => p.date);
        const allProjects = Object.keys(projectData).filter(
          (pid) => !pid.includes("_demo-datasource-project"),
        );
        // pretty sure the results won't have any holes in it, but just in case, this zeros out the values, which will be updated later.
        const projectsZerodRow = {};
        allProjects.forEach((p) => {
          projectsZerodRow[projectMap.get(p) || p] = 0;
        });
        const dateRows = {};
        allDates.forEach((d) => {
          dateRows[d] = { date: d, ...projectsZerodRow };
        });
        // now loop and append the actual values
        allProjects.forEach((p) => {
          if (projectData[p]) {
            projectData[p].forEach((pd) => {
              dateRows[pd.date][projectMap.get(p)] = pd.numExp;
            });
          }
        });
        return Object.values(dateRows);
      } else if (type === "status") {
        const statusData = data?.byStatus || null;
        if (!statusData) return [];
        const monthData: {
          date: string;
          draft: number;
          running: number;
          stopped: number;
        }[] = [];
        statusData.draft.forEach((sd, i) => {
          const row = {
            date: sd.date,
            draft: sd.numExp,
            running: statusData.running[i].numExp,
            stopped: statusData.stopped[i].numExp,
          };
          monthData.push(row);
        });
        return monthData;
      } else if (type === "results") {
        const resultsData = data?.byResults || null;
        if (!resultsData) return [];
        const monthData: {
          date: string;
          dnf: number;
          won: number;
          lost: number;
          inconclusive: number;
        }[] = [];
        resultsData.won.forEach((rd, i) => {
          const row = {
            date: rd.date,
            dnf: resultsData.dnf[i].numExp,
            won: rd.numExp,
            lost: resultsData.lost[i].numExp,
            inconclusive: resultsData.inconclusive[i].numExp,
          };
          monthData.push(row);
        });
        return monthData;
      }
    },
    [data, projectMap],
  );

  const downloadCSV = useCallback(
    (type) => {
      try {
        const formatedData = parseDataForCSV(type);
        const json2csvParser = new Parser();
        const csv = json2csvParser.parse(formatedData);

        const blob = new Blob([csv], { type: "text/csv" });
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = type + "_experiments_by_month.csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
      } catch (e) {
        console.error(e);
        return "";
      }
    },
    [parseDataForCSV],
  );

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const graphData = data.all;
  const statuses = Object.keys(data.byStatus).filter((s) => s !== "all");

  if (showBy === "status") {
    stackedKeys = statuses;
    data.all.forEach((d, i) => {
      statuses.forEach((s) => {
        const statusData = data.byStatus[s].find((sd) => sd.date === d.date);
        if (!statusData) return;
        graphData[i][s] = statusData.numExp;
      });
    });
  }

  if (showBy === "results") {
    stackedKeys = ["won", "lost", "inconclusive", "dnf"];
    data.byResults.won.forEach((d, i) => {
      stackedKeys.forEach((s) => {
        const resultData = data.byResults[s].find((sd) => sd.date === d.date);
        if (!resultData) return;
        graphData[i][s] = resultData.numExp;
      });
    });
  }

  if (showBy === "project") {
    stackedKeys = projects.map((p) => p.id);
    stackedKeys.push("all");
    data.byProject.all.forEach((d, i) => {
      projects.forEach((p) => {
        const projectData = data.byProject[p.id].find(
          (pd) => pd.date === d.date,
        );
        if (projectData) {
          graphData[i][p.id] = projectData.numExp;
        } else {
          graphData[i][p.id] = 0;
        }
      });
      graphData[i]["all"] = d.numExp;
    });
  }

  if (!graphData.length) {
    return (
      <>
        <div className="row mb-1 align-content-end">
          <div className="col">
            <h4 className="mb-0">
              {title}{" "}
              {projectMap.has(project) ? "for " + projectMap.get(project) : ""}
            </h4>
          </div>
          <div>No data to show</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="row mb-1 align-content-end">
        <div className="col">
          <h4 className="mb-0">
            {title}{" "}
            {projectMap.has(project) ? "for " + projectMap.get(project) : ""}
          </h4>
        </div>
        <div className="col-auto">
          <SelectField
            containerClassName="d-inline-block ml-2 mb-0"
            options={showSelectOptions}
            value={showBy}
            onChange={(value) => {
              if (
                value === "user" ||
                value === "all" ||
                value === "project" ||
                value === "results" ||
                value === "status"
              ) {
                setShowBy(value);
              }
            }}
          />
        </div>
        <div className="pt-2">
          <MoreMenu>
            <div className="p-2 px-3">Download data as CSV...</div>
            <a
              href="#"
              className="dropdown-item"
              onClick={(e) => {
                e.preventDefault();
                downloadCSV("all");
              }}
            >
              Totals
            </a>
            <a
              href="#"
              className="dropdown-item"
              onClick={(e) => {
                e.preventDefault();
                downloadCSV("projects");
              }}
            >
              By Projects
            </a>
            <a
              href="#"
              className="dropdown-item"
              onClick={(e) => {
                e.preventDefault();
                downloadCSV("status");
              }}
            >
              By Status
            </a>
            <a
              href="#"
              className="dropdown-item"
              onClick={(e) => {
                e.preventDefault();
                downloadCSV("results");
              }}
            >
              By Results
            </a>
          </MoreMenu>
        </div>
      </div>

      <ParentSizeModern>
        {({ width }) => {
          const margin = [15, 30, 30, 30];
          const yMax = height - margin[0] - margin[2];
          const xMax = width - margin[1] - margin[3];
          const maxYValue = Math.ceil(
            Math.max(...graphData.map((d) => d.numExp), 1),
          );

          const barWidth = 35;
          const xScale = scaleBand({
            domain: graphData.map((d) => {
              return new Date(d.date);
            }),
            range: [barWidth / 2, xMax],
            round: true,
            align: 0.5,
            padding: 1,
            paddingOuter: 0.15,
          });
          const yScale = scaleLinear<number>({
            domain: [0, maxYValue],
            range: [yMax, 0],
            round: true,
          });

          const handlePointer = (event: React.MouseEvent<SVGElement>) => {
            const coords = localPoint(event);
            const xCoord = (coords?.x ?? 0) - barWidth;

            const barData = graphData.map((d) => {
              return {
                raw: { ...d },
                xcord: xScale(getValidDate(d.date)),
                numExp: d.numExp,
              };
            });

            const closestBar = barData.reduce((prev, curr) =>
              Math.abs((curr?.xcord ?? 0) - xCoord) <
              Math.abs((prev?.xcord ?? 0) - xCoord)
                ? curr
                : prev,
            );

            let barHeight = yMax - (yScale(closestBar.numExp) ?? 0);
            if (barHeight === 0) barHeight = 6;
            const barY = yMax - barHeight;

            showTooltip({
              tooltipTop:
                showBy === "all" ? barY - 15 : stackedKeys.length * 20 * -1, //<- estimate the rough number of lines we're going to show
              tooltipLeft: closestBar.xcord,
              tooltipData: closestBar.raw,
            });
          };

          return (
            <div
              onMouseLeave={() => {
                window.setTimeout(() => {
                  hideTooltip();
                }, 100);
              }}
            >
              <div style={{ position: "relative" }}>
                {tooltipOpen && (
                  <TooltipWithBounds
                    left={tooltipLeft}
                    top={tooltipTop}
                    className={
                      showBy === "all" ? styles.tooltip : styles.tooltiplg
                    }
                    unstyled={true}
                  >
                    <>
                      {showBy === "project" ? (
                        <>
                          <h4 className={`mb-1 ${styles.tooltipHeader}`}>
                            {format(getValidDate(tooltipData?.date), "MMM yyy")}
                          </h4>
                          {stackedKeys.map((k) => (
                            <div key={k} className={styles.tooltipRow}>
                              <div className={styles.tooltipName}>
                                {projectMap.has(k)
                                  ? projectMap.get(k)
                                  : k === "all"
                                    ? "All projects"
                                    : k}
                              </div>
                              <div className={styles.tooltipValue}>
                                {tooltipData?.[k] ?? 0}
                              </div>
                            </div>
                          ))}
                        </>
                      ) : showBy === "status" || showBy === "results" ? (
                        <>
                          <h4 className="mb-1">
                            {format(getValidDate(tooltipData?.date), "MMM yyy")}
                          </h4>
                          {stackedKeys.map((k) => (
                            <div key={k} className={styles.tooltipRow}>
                              <div className={styles.tooltipName}>{k}</div>
                              <div className={styles.tooltipValue}>
                                {tooltipData?.[k] ?? 0}
                              </div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <>
                          {tooltipData?.numExp} experiment
                          {tooltipData?.numExp !== 1 ? "s" : ""}
                        </>
                      )}
                    </>
                  </TooltipWithBounds>
                )}
              </div>
              <svg width={width} height={height} onMouseMove={handlePointer}>
                <Group left={margin[3]} top={margin[0]}>
                  <GridRows
                    scale={yScale}
                    numTicks={Math.min(maxYValue, 5)}
                    width={xMax + barWidth / 2}
                    stroke="var(--border-color-200)"
                  />
                  {graphData.map((d, i) => {
                    const barX =
                      (xScale(getValidDate(d.date)) ?? 0) - barWidth / 2;
                    let barHeight = yMax - (yScale(d.numExp) ?? 0);
                    // if there are no experiments this month, show a little nub for design reasons.
                    if (barHeight === 0) barHeight = 4;
                    const barY = yMax - barHeight;
                    const name = format(getValidDate(d.date), "MMM yyy");
                    if (showBy === "all") {
                      return (
                        <BarRounded
                          key={name + i}
                          x={barX + 5}
                          y={barY}
                          width={Math.max(10, barWidth - 10)}
                          height={barHeight}
                          fill={"#73D1F0"}
                          top
                          radius={6}
                          className={styles.barHov}
                        />
                      );
                    }

                    // Stacked bar version:
                    return (
                      <BarStack
                        key={name + i}
                        data={graphData}
                        keys={stackedKeys}
                        x={(d) => new Date(d.date)}
                        yScale={yScale}
                        xScale={xScale}
                        radius={6}
                        color={getGraphColor}
                      >
                        {(barStacks) => {
                          // each barStack is a group of bars for a given key
                          // since we are stacking by date, we need to find index of the top bar for each date
                          // and show that one as rounded
                          const topBarsIndex = {};
                          barStacks.map((barStack) => {
                            barStack.bars.forEach((bar, i) => {
                              if (bar.height > 0) {
                                topBarsIndex[i] = bar.key;
                              }
                            });
                          });

                          return barStacks.map((barStack) => {
                            return barStack.bars.map((bar, i) => {
                              if (bar.height === 0) return null;
                              if (topBarsIndex?.[i] === bar.key) {
                                return (
                                  <BarRounded
                                    key={`bar-stack-${barStack.index}-${bar.index}`}
                                    x={bar.x - 10}
                                    y={bar.y}
                                    height={Math.max(bar.height, 0)}
                                    width={Math.max(10, barWidth - 10)}
                                    fill={bar.color}
                                    top
                                    radius={6}
                                    className={styles.barHovStacked}
                                  />
                                );
                              }
                              return (
                                <rect
                                  key={`bar-stack-${barStack.index}-${bar.index}`}
                                  x={bar.x - 10}
                                  y={bar.y}
                                  height={Math.max(bar.height, 0)}
                                  width={Math.max(10, barWidth - 10)}
                                  fill={bar.color}
                                  className={styles.barHovStacked}
                                />
                              );
                            });
                          });
                        }}
                      </BarStack>
                    );
                  })}

                  <AxisBottom
                    top={yMax}
                    scale={xScale}
                    numTicks={
                      width > 670
                        ? graphData.length
                        : Math.ceil(graphData.length / 2)
                    }
                    tickLabelProps={() => ({
                      fill: "var(--text-color-table)",
                      fontSize: 11,
                      textAnchor: "start",
                      dx: -25,
                    })}
                    hideAxisLine={false}
                    stroke={"var(--text-color-table)"}
                    hideTicks={true}
                    rangePadding={barWidth / 2}
                    tickFormat={(v) => {
                      return format(v as Date, "LLL yyyy");
                    }}
                  />
                  <AxisLeft
                    scale={yScale}
                    numTicks={Math.min(maxYValue, 5)}
                    tickLabelProps={() => ({
                      fill: "var(--text-color-table)",
                      fontSize: 11,
                      textAnchor: "end",
                      dx: -2,
                      dy: 2,
                    })}
                    stroke={"var(--text-color-table)"}
                    hideTicks={true}
                    tickFormat={(v) => {
                      return Math.round(v as number) + "";
                    }}
                  />
                </Group>
              </svg>
              {showBy !== "all" && (
                <>
                  <div className={styles.legendWrap}>
                    {stackedKeys.map((k) => (
                      <div key={k} className={styles.legendRow}>
                        <div
                          className={styles.legendColor}
                          style={{ backgroundColor: getGraphColor(k) }}
                        ></div>
                        <div className={styles.legendName}>
                          {projectMap.has(k)
                            ? projectMap.get(k)
                            : k === "all"
                              ? "All projects"
                              : k}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        }}
      </ParentSizeModern>
    </>
  );
}
