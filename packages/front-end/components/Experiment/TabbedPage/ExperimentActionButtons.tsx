import Button from "@/components/Radix/Button";

export interface Props {
  editResult?: () => void;
  editTargeting?: (() => void) | null;
  isBandit?: boolean;
}

export default function ExperimentActionButtons({
  editResult,
  editTargeting,
  isBandit,
}: Props) {
  return (
    <div className="d-flex">
      <Button
        mr="2"
        disabled={!editTargeting}
        onClick={() => editTargeting?.()}
      >
        Make Changes
      </Button>
      <Button
        variant="outline"
        onClick={() => editResult?.()}
        disabled={!editResult}
      >
        Stop {isBandit ? "Bandit" : "Experiment"}
      </Button>
    </div>
  );
}
