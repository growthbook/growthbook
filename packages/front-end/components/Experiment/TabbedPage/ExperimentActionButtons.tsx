import Button from "@/components/Radix/Button";

export interface Props {
  editResult?: () => void;
  editTargeting?: (() => void) | null;
}

export default function ExperimentActionButtons({
  editResult,
  editTargeting,
}: Props) {
  return (
    <div>
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
        Stop Experiment
      </Button>
    </div>
  );
}
