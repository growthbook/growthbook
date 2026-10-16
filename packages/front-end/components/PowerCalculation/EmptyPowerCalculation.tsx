export default function EmptyPowerCalculation({
  showModal,
}: {
  showModal: () => void;
}) {
  return (
    // PROTOTYPE (set in review): no spacing or width of its own (was a
    // second page wrapper inside the page's: 15px padding, a centred fixed
    // width, ml-1 and pr-4), so the calculator sits in the app-wide page
    // frame (global.scss).
    <div>
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
