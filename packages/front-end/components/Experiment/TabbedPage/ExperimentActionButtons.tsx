import { ExperimentResultStatusData } from "back-end/types/experiment";
import Button from "@/components/Radix/Button";

export interface Props {
  editResult?: () => void;
  editTargeting?: (() => void) | null;
  isBandit?: boolean;
  runningExperimentStatus?: ExperimentResultStatusData;
}

export default function ExperimentActionButtons({
  editResult,
  editTargeting,
  isBandit,
  runningExperimentStatus,
}: Props) {
  const runningStatus = runningExperimentStatus?.status;

  const readyForDecision =
    runningStatus === "ship-now" ||
    runningStatus === "ready-for-review" ||
    runningStatus === "rollback-now";

  return (
    <div className="d-flex ml-2">
      <Button
        variant={readyForDecision ? "outline" : "solid"}
        mr="3"
        disabled={!editTargeting}
        onClick={() => editTargeting?.()}
      >
        Make Changes
      </Button>
      <Button
        variant={readyForDecision ? "solid" : "outline"}
        onClick={() => editResult?.()}
        disabled={!editResult}
      >
        {readyForDecision ? (
          "Make Decision"
        ) : (
          <>Stop {isBandit ? "Bandit" : "Experiment"}</>
        )}
      </Button>
    </div>
  );
}
