import clsx from "clsx";

export interface Props {
  editResult?: () => void;
  editTargeting?: (() => void) | null;
  coverage?: number;
}

export default function StopExperimentButton({
  editResult,
  editTargeting,
  coverage,
}: Props) {
  const fullCoverage = coverage === 1;

  return (
    <div className={clsx({ "btn-group": false })}>
      {!fullCoverage ? (
        <button
          className="btn btn-info mr-2"
          disabled={!editTargeting}
          onClick={() => {
            editTargeting && editTargeting();
          }}
        >
          Increase Traffic ({(coverage ?? 0) * 100}%)
        </button>
      ) : null}
      <button
        className={clsx("btn", {
          "btn-primary": fullCoverage,
          "btn-outline-primary": !fullCoverage,
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
