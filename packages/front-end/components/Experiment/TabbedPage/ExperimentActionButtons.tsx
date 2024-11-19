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
    <div className="d-flex ml-2">
      <Button
        mr="3"
        disabled={!editTargeting}
        onClick={() => editTargeting?.()}
      >
        修改
      </Button>
      <Button
        variant="outline"
        onClick={() => editResult?.()}
        disabled={!editResult}
      >
        停止{isBandit ? "Bandit" : "Experiment"}
      </Button>
    </div>
  );
}
