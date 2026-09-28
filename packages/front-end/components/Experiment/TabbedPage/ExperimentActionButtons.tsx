import { ExperimentResultStatusData } from "shared/types/experiment";
import { HoldoutStage } from "shared/util";
import { Flex } from "@radix-ui/themes";
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
  // Neither is offered without permission to run it, as on the feature page.
  if (!editResult && (holdoutStage || !editTargeting)) return null;
  return (
    <Flex ml="2" gap="3">
      {!holdoutStage && editTargeting ? (
        <Button
          variant={readyForDecision ? "outline" : "solid"}
          onClick={editTargeting}
        >
          Make Changes
        </Button>
      ) : null}
      {editResult ? (
        <Button
          variant={readyForDecision ? "solid" : "outline"}
          onClick={editResult}
        >
          {displayCTAText()}
        </Button>
      ) : null}
    </Flex>
  );
}
