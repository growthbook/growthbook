import { ExperimentResultStatusData } from "shared/types/experiment";
import { HoldoutStage } from "shared/util";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";

export interface Props {
  editResult?: () => void;
  editTargeting?: (() => void) | null;
  isBandit?: boolean;
  runningExperimentStatus?: ExperimentResultStatusData;
  holdoutStage?: HoldoutStage;
  disabledReason?: string;
}

export default function ExperimentActionButtons({
  editResult,
  editTargeting,
  isBandit,
  runningExperimentStatus,
  holdoutStage,
  disabledReason,
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
        <Tooltip
          shouldDisplay={!editTargeting && !!disabledReason}
          body={disabledReason}
        >
          <Button
            variant={readyForDecision ? "outline" : "solid"}
            mr="3"
            disabled={!editTargeting}
            onClick={() => editTargeting?.()}
          >
            Make Changes
          </Button>
        </Tooltip>
      )}
      <Tooltip
        shouldDisplay={!editResult && !!disabledReason}
        body={disabledReason}
      >
        <Button
          variant={readyForDecision ? "solid" : "outline"}
          onClick={() => editResult?.()}
          disabled={!editResult}
        >
          {displayCTAText()}
        </Button>
      </Tooltip>
    </div>
  );
}
