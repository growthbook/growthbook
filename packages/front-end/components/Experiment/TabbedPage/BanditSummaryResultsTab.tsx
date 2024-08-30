import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import TabButton from "@/components/Tabs/TabButton";
import TabButtons from "@/components/Tabs/TabButtons";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
}

export default function BanditSummaryResultsTab({ experiment }: Props) {
  const [tab, setTab] = useLocalStorage<"probabilities" | "weights">(
    `banditSummaryResultsTab__${experiment.id}`,
    "probabilities"
  );

  // const { metrics, getExperimentMetricById, getMetricById } = useDefinitions();
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

  console.log(experiment.phases[experiment.phases.length - 1].banditEvents);

  return (
    <div className="bg-white border mt-3">
      <div className="mb-2" style={{ overflowX: "initial" }}>
        <div className="m-3 mb-5">
          <h3>Graph of variations with uplift stats</h3>
        </div>

        <div className="m-3">
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
      </div>
    </div>
  );
}
