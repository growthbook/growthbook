import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import TabButton from "@/components/Tabs/TabButton";
import TabButtons from "@/components/Tabs/TabButtons";
import BanditSummaryTable from "@/components/Experiment/BanditSummaryTable";
import {useDefinitions} from "@/services/DefinitionsContext";
import {getRenderLabelColumn} from "@/components/Experiment/CompactResults";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  isTabActive?: boolean;
}

export default function BanditSummaryResultsTab({
  experiment,
  isTabActive,
}: Props) {
  const [tab, setTab] = useLocalStorage<"probabilities" | "weights">(
    `banditSummaryResultsTab__${experiment.id}`,
    "probabilities"
  );

  const phase = experiment.phases?.[experiment.phases.length - 1];

  const mid = experiment.goalMetrics[0];
  const { getMetricById } = useDefinitions();
  const metric = getMetricById(mid);
  //
  // const allExperimentMetricIds = getAllMetricIdsFromExperiment(
  //   experiment,
  //   false
  // );
  // const allExperimentMetrics = allExperimentMetricIds.map((m) =>
  //   getExperimentMetricById(m)
  // );
  // const denominatorMetricIds = uniq<string>(
  //   allExperimentMetrics
  //     .map((m) => m?.denominator)
  //     .filter((d) => d && typeof d === "string") as string[]
  // );
  // const denominatorMetrics = denominatorMetricIds
  //   .map((m) => getMetricById(m as string))
  //   .filter(isDefined);


  const showVisualizations = (phase?.banditEvents?.length ?? 0) > 0;

  return (
    <div className="bg-white border mt-3">
      <div className="mt-3 mb-4">
        <h3 className="mx-2 mb-3">Bandit Overview</h3>

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
            <div className="mx-2 h4 mb-0">
              {metric ? getRenderLabelColumn(
                false,
                "bayesian"
              )("", metric): null}
            </div>
            <BanditSummaryTable
              experiment={experiment}
              metric={metric}
              isTabActive={isTabActive} // todo: huh?
            />
          </>
        )}
      </div>

      {showVisualizations && (
        <div className="mx-3 my-4">
          <h3>Time series</h3>
          <TabButtons>
            <TabButton
              active={tab === "probabilities"}
              display="Probabilities"
              onClick={() => setTab("probabilities")}
              newStyle={true}
              activeClassName="active-tab"
            />
            <TabButton
              active={tab === "weights"}
              display="Variation Weights"
              onClick={() => setTab("weights")}
              newStyle={true}
              activeClassName="active-tab"
              last={true}
            />
          </TabButtons>
        </div>
      )}
    </div>
  );
}
