import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React from "react";
import { LiaChartLineSolid } from "react-icons/lia";
import { TbChartAreaLineFilled } from "react-icons/tb";
import { ago } from "shared/dates";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import BanditSummaryTable from "@/components/Experiment/BanditSummaryTable";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import BanditDateGraph from "@/components/Experiment/BanditDateGraph";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  isTabActive?: boolean;
}

export default function BanditSummaryResultsTab({
  experiment,
  isTabActive,
}: Props) {
  const [chartMode, setChartMode] = useLocalStorage<
    "values" | "probabilities" | "weights"
  >(`banditSummaryResultsChartMode__${experiment.id}`, "values");
  const [chartType, setChartType] = useLocalStorage<"area" | "line">(
    `banditSummaryResultsChartType__${experiment.id}`,
    "line"
  );

  const phase = experiment.phases?.[experiment.phases.length - 1];

  const mid = experiment.goalMetrics[0];
  const { getMetricById } = useDefinitions();
  const metric = getMetricById(mid);

  const showVisualizations = (phase?.banditEvents?.length ?? 0) > 0;

  return (
    <>
      <h3 className="mt-4 mb-3">Bandit Overview</h3>
      <div className="box pt-3">
        {experiment.status === "draft" && (
          <div className="alert bg-light border mx-3">
            Your experiment is still in a <strong>draft</strong> state. You must
            start the experiment first before seeing results.
          </div>
        )}

        {experiment.status === "running" && (
          <>
            {experiment.banditPhase === "explore" ? (
              <div className="alert bg-light border mx-3">
                This bandit experiment is still in its burn-in (explore) phase.
                Please wait a little while longer.
              </div>
            ) : !phase?.banditEvents?.length ? (
              <div className="alert alert-info mx-3">
                No data yet.
                {/*todo: differentiate new (no runs) versus problem*/}
              </div>
            ) : null}
          </>
        )}

        {showVisualizations && (
          <>
            <div className="mx-3 h4 mb-0">
              {metric
                ? getRenderLabelColumn(false, "bayesian")("", metric)
                : null}
            </div>
            <BanditSummaryTable
              experiment={experiment}
              metric={metric}
              isTabActive={!!isTabActive}
            />
          </>
        )}
      </div>

      {showVisualizations && (
        <>
          <h3 className="mt-4 mb-3">Variation Performance over Time</h3>
          <div className="box px-3 py-3">
            <div className="d-flex" style={{ height: 90 }}>
              <div>
                <label className="uppercase-title">Chart</label>
                <ButtonSelectField
                  value={chartMode}
                  setValue={(v) => setChartMode(v)}
                  options={[
                    {
                      label: "Cumulative Variation Means",
                      value: "values",
                    },
                    {
                      label: "Probability of Winning",
                      value: "probabilities",
                    },
                    {
                      label: "Variation Weights",
                      value: "weights",
                    },
                  ]}
                />
              </div>
              {chartMode !== "values" && (
                <div className="ml-4">
                  <label className="uppercase-title">Chart type</label>
                  <ButtonSelectField
                    value={chartType}
                    setValue={(v) => setChartType(v)}
                    options={[
                      {
                        label: <LiaChartLineSolid size={20} />,
                        value: "line",
                      },
                      {
                        label: <TbChartAreaLineFilled size={20} />,
                        value: "area",
                      },
                    ]}
                  />
                </div>
              )}
              <div className="flex-1" />
              <div>
                <label className="uppercase-title">Bandit Status</label>
                <table className="table-tiny">
                  <tbody>
                    <tr>
                      <td className="text-muted">Bandit phase:</td>
                      <td>{experiment.banditPhase ?? ""}</td>
                    </tr>
                    <tr>
                      <td className="text-muted">Update cadence:</td>
                      <td>
                        every {experiment.banditScheduleValue ?? ""}{" "}
                        {experiment.banditScheduleUnit ?? ""}
                      </td>
                    </tr>
                    {["explore", "exploit"].includes(
                      experiment.banditPhase ?? ""
                    ) && (
                      <tr>
                        <td className="text-muted">Next run:</td>
                        <td>
                          {experiment.nextSnapshotAttempt &&
                          experiment.autoSnapshots ? (
                            ago(experiment.nextSnapshotAttempt)
                          ) : (
                            <em>Not scheduled</em>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <BanditDateGraph
                experiment={experiment}
                metric={metric}
                label={
                  chartMode === "values"
                    ? undefined
                    : chartMode === "probabilities"
                    ? "Probability of Winning"
                    : "Variation Weight"
                }
                mode={chartMode}
                type={chartMode === "values" ? "line" : chartType}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
