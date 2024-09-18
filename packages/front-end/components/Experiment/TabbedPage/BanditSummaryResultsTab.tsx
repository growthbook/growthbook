import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React from "react";
import { LiaChartLineSolid } from "react-icons/lia";
import { TbChartAreaLineFilled } from "react-icons/tb";
import { ago, datetime } from "shared/dates";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import BanditSummaryTable from "@/components/Experiment/BanditSummaryTable";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import BanditDateGraph from "@/components/Experiment/BanditDateGraph";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import RefreshBanditButton from "@/components/Experiment/RefreshBanditButton";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  isTabActive?: boolean;
}

export default function BanditSummaryResultsTab({
  experiment,
  mutate,
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
  const lastEvent =
    phase?.banditEvents?.[(phase?.banditEvents?.length ?? 0) - 1];
  const lastRun = lastEvent?.date;

  const mid = experiment.goalMetrics[0];
  const { getMetricById } = useDefinitions();
  const metric = getMetricById(mid);

  const showVisualizations = (phase?.banditEvents?.length ?? 0) > 0;

  return (
    <>
      <h3 className="mt-4 mb-3">Bandit Leaderboard</h3>
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
            <div className="d-flex mx-3 align-items-center">
              <div className="h4 mb-0">
                {metric
                  ? getRenderLabelColumn(false, "bayesian")("", metric)
                  : null}
              </div>

              <div className="flex-1" />

              <div className="d-flex align-items-center">
                <div
                  className="text-muted text-right mr-3"
                  style={{ maxWidth: 130, fontSize: "0.8em" }}
                >
                  <div className="font-weight-bold" style={{ lineHeight: 1.2 }}>
                    last updated
                  </div>
                  <div className="d-flex align-items-center">
                    <div
                      style={{ lineHeight: 1 }}
                      title={datetime(lastRun ?? "")}
                    >
                      {ago(lastRun ?? "")}
                    </div>
                  </div>
                </div>
                <div
                  className="text-muted text-right mr-3"
                  style={{ maxWidth: 130, fontSize: "0.8em" }}
                >
                  <div className="font-weight-bold" style={{ lineHeight: 1.2 }}>
                    next update
                  </div>
                  <div className="d-flex align-items-center">
                    <div
                      style={{ lineHeight: 1 }}
                      title={datetime(experiment.nextSnapshotAttempt ?? "")}
                    >
                      {experiment.nextSnapshotAttempt &&
                      experiment.autoSnapshots ? (
                        ago(experiment.nextSnapshotAttempt)
                      ) : (
                        <em>Not scheduled</em>
                      )}
                    </div>
                  </div>
                </div>
                <RefreshBanditButton mutate={mutate} experiment={experiment} />
              </div>
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
          <div className="box px-3 py-2">
            <div className="d-flex mb-4 pb-2">
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
            </div>
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
        </>
      )}
    </>
  );
}
