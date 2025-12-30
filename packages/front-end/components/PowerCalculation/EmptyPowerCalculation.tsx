export default function EmptyPowerCalculation({
  showModal,
}: {
  showModal: () => void;
}) {
  return (
    <div className="contents container pagecontents ml-1 pr-4">
      <div className="row mb-4">
        <div className="col">
          <div className="d-flex justify-space-between align-items-center">
            <h1>Power Calculator</h1>
          </div>
        </div>
        <div className="col-auto">
          <button
            className="btn btn-primary float-right"
            onClick={() => showModal()}
            type="button"
          >
            New Calculation
          </button>
        </div>
      </div>
      <div className="appbox mb-3">
        <div className="text-center m-5">
          <div className="card-title mb-1">
            <h3>Calculate Experiment Power</h3>
          </div>
          <div className="card-text mb-4">
            Plan the duration of your next experiment.
          </div>
          <button
            className="btn action-link mr-3 btn-primary mt-3"
            onClick={() => showModal()}
            type="button"
          >
            New Calculation
          </button>
        </div>
      </div>
    </div>
  );
}
