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
      <button
        className="btn btn-primary mr-2"
        disabled={!editTargeting}
        onClick={() => {
          editTargeting && editTargeting();
        }}
      >
        Make Changes
      </button>
      <button
        className="btn btn-outline-primary"
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
