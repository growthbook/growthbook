import { ExperimentResultStatusData } from "back-end/types/experiment";
import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import Button from "@/ui/Button";

export interface Props {
  editResult?: () => void;
  editTargeting?: (() => void) | null;
  isBandit?: boolean;
  runningExperimentStatus?: ExperimentResultStatusData;
  holdout?: HoldoutInterface;
}

export default function ExperimentActionButtons({
  editResult,
  editTargeting,
  isBandit,
  runningExperimentStatus,
  holdout,
}: Props) {
  const runningStatus = runningExperimentStatus?.status;

  const readyForDecision =
    runningStatus === "ship-now" ||
    runningStatus === "ready-for-review" ||
    runningStatus === "rollback-now";
  const displayCTAText = () => {
    if (holdout) {
      return !holdout?.analysisStartDate
        ? "Start Analysis Period"
        : "Stop Holdout";
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
      {!holdout && (
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
