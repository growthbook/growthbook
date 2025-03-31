import Button from "@/components/Radix/Button";
import { ExperimentResultStatusData } from "back-end/types/experiment";

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
  
  const primaryButton = runningStatus === "ship-now" || runningStatus === "ready-for-review" || runningStatus === "rollback-now" ? "stop" : "make-changes";

  return (
    <div className="d-flex ml-2">
      <Button
        variant={primaryButton === "make-changes" ? "solid" : "outline"}
        mr="3"
        disabled={!editTargeting}
        onClick={() => editTargeting?.()}
      >
        Make Changes
      </Button>
      <Button
        variant={primaryButton === "stop" ? "solid" : "outline"}
        onClick={() => editResult?.()}
        disabled={!editResult}
      >
        Stop {isBandit ? "Bandit" : "Experiment"}
      </Button>
    </div>
  );
}
