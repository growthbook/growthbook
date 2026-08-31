import { ExperimentResultStatusData } from "shared/types/experiment";
import { HoldoutStage } from "shared/util";
import Button from "@/ui/Button";

export interface Props {
  editResult?: () => void;
  editTargeting?: (() => void) | null;
  isBandit?: boolean;
  runningExperimentStatus?: ExperimentResultStatusData;
  holdoutStage?: HoldoutStage;
}

export default function ExperimentActionButtons({
  editResult,
  editTargeting,
  isBandit,
  runningExperimentStatus,
  holdoutStage,
}: Props) {
  const runningStatus = runningExperimentStatus?.status;

  const readyForDecision =
    runningStatus === "ship-now" ||
    runningStatus === "ready-for-review" ||
    runningStatus === "scheduled-end-review" ||
    runningStatus === "rollback-now";
  const displayCTAText = () => {
    if (holdoutStage) {
      return holdoutStage === "analysis-period"
        ? "Stop Holdout"
        : "Start Analysis Phase";
    }
    if (readyForDecision) {
      return "Make Decision";
    } else if (isBandit) {
      return "Stop Bandit";
    } else {
      return "Stop Experiment";
    }
  };
  return (
    <div className="d-flex ml-2">
      {!holdoutStage && (
        <Button
          variant={readyForDecision ? "outline" : "solid"}
          mr="3"
          disabled={!editTargeting}
          onClick={() => editTargeting?.()}
        >
          Make Changes
        </Button>
      )}
      <Button
        variant={readyForDecision ? "solid" : "outline"}
        onClick={() => editResult?.()}
        disabled={!editResult}
      >
        {displayCTAText()}
      </Button>
    </div>
  );
}
