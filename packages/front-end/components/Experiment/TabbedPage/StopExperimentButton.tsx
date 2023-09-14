import clsx from "clsx";

export interface Props {
  editResult?: () => void;
  editTargeting?: (() => void) | null;
  coverage?: number;
  hasLinkedChanges: boolean;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

export default function StopExperimentButton({
  editResult,
  editTargeting,
  coverage,
  hasLinkedChanges,
}: Props) {
  const showTrafficButton = hasLinkedChanges && (coverage ?? 1) < 1;

  return (
    <div className={clsx({ "btn-group": false })}>
      {showTrafficButton ? (
        <button
          className="btn btn-primary mr-2"
          disabled={!editTargeting}
          onClick={() => {
            editTargeting && editTargeting();
          }}
        >
          Increase Traffic ({percentFormatter.format(coverage ?? 1)})
        </button>
      ) : null}
      <button
        className={clsx("btn", {
          "btn-primary": !showTrafficButton,
          "btn-outline-primary": showTrafficButton,
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
