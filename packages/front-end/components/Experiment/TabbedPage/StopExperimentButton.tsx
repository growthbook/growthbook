import clsx from "clsx";

export interface Props {
  editResult?: () => void;
  editTargeting?: (() => void) | null;
  coverage?: number;
  hasLinkedChanges: boolean;
}

export default function StopExperimentButton({
  editResult,
  editTargeting,
  coverage,
  hasLinkedChanges,
}: Props) {
  const showMakeChangesButton = hasLinkedChanges && (coverage ?? 1) < 1;

  return (
    <div className={clsx({ "btn-group": false })}>
      {showMakeChangesButton ? (
        <button
          className="btn btn-primary mr-2"
          disabled={!editTargeting}
          onClick={() => {
            editTargeting && editTargeting();
          }}
        >
          Make Changes
        </button>
      ) : null}
      <button
        className={clsx("btn", {
          "btn-primary": !showMakeChangesButton,
          "btn-outline-primary": showMakeChangesButton,
        })}
        onClick={(e) => {
          e.preventDefault();
          if (editResult) {
            editResult();
          }
        }}
        disabled={!editResult}
      >
        Stop Experiment
      </button>
    </div>
  );
}
