import Link from "next/link";
import { useState } from "react";
import { PowerCalculationResults } from "@/components/PowerCalculation/types";
import { ensureAndReturn } from "@/types/utils";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

const AnalysisSettings = ({
  results,
  updateVariations,
}: {
  results: PowerCalculationResults;
  updateVariations: (_: number) => void;
}) => {
  const [currentVariations, setCurrentVariations] = useState(
    results.variations
  );

  return (
    <div className="row card gsbox mb-3 border">
      <div className="row pt-4 pl-4 pr-4 pb-1">
        <div className="col-7">
          <h2>Analysis Settings</h2>
          <p>
            {results.variations} Variations · Frequentist (Sequential Testing
            enabled) · <Link href="#">Edit</Link>
          </p>
          <div className="alert alert-info w-75">
            <span className="font-weight-bold">
              Run experiment for {results.duration} weeks
            </span>{" "}
            to achieve {percentFormatter.format(results.power)} power for all
            metric.
          </div>
        </div>
        <div className="vr"></div>
        <div className="col-4 align-self-end">
          <div className="font-weight-bold mb-2"># of Variations</div>
          <div className="form-group pb-3">
            <div className="d-inline pr-3">
              <input
                type="number"
                className="form-control w-50 d-inline"
                value={currentVariations}
                onChange={(e) => setCurrentVariations(Number(e.target.value))}
              />
            </div>
            <button
              disabled={currentVariations === results.variations}
              onClick={() => updateVariations(currentVariations)}
              className="btn border border-primary text-primary"
            >
              Update
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const MetricLabel = ({ name, type }: { name: string; type: string }) => (
  <>
    <div className="font-weight-bold">{name}</div>
    <div className="text-muted font-italic">
      {type === "binomial" ? "Proportion" : "Mean"}
    </div>
  </>
);

const SampleSizeAndRuntime = ({
  sampleSizeAndRuntime,
}: {
  sampleSizeAndRuntime: PowerCalculationResults["sampleSizeAndRuntime"];
}) => (
  <div className="row card gsbox mb-3 border">
    <div className="row pt-4 pl-4 pr-4 pb-1">
      <div className="col-7">
        <h2>Calculated Sample Size & Runtime</h2>
        <p>
          Needed sample sizes are based on total number of users across all
          variations.
        </p>

        <table className="table gbtable table-hover appbox">
          <thead
            className="sticky-top bg-white shadow-sm"
            style={{ top: "56px", zIndex: 900 }}
          >
            <tr>
              <th>Metric</th>
              <th>Effect Size</th>
              <th>Meeded Sample</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(sampleSizeAndRuntime).map((id) => {
              const { type, users, days, effect, name } = ensureAndReturn(
                sampleSizeAndRuntime[id]
              );

              return (
                <tr key={name}>
                  <td>
                    <MetricLabel name={name} type={type} />
                  </td>
                  <td>{percentFormatter.format(effect)}</td>
                  <td>
                    {days} days; {users} users
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="col-4 align-self-center">
        <div className="card alert alert-info">
          <div className="card-title uppercase-title mb-0">Summary</div>
          <h4>Total Revenue</h4>
          <p>
            Reliably detecting a lift of{" "}
            <span className="font-weight-bold">X%</span> requires running your
            experiment for <span className="font-weight-bold">Z days</span>{" "}
            (roughly collecting{" "}
            <span className="font-weight-bold">Y users</span>)
          </p>
        </div>
      </div>
    </div>
  </div>
);

const MinimumDetectableEffect = ({
  weeks,
}: {
  weeks: PowerCalculationResults["weeks"];
}) => (
  <div className="row card gsbox mb-3 border">
    <div className="row pt-4 pl-4 pr-4 pb-1">
      <h2>Minimum Detectable Effect Over Time</h2>
      <p>
        To achieve 80% power for all metrics, we advocate running your
        experiment for at least{" "}
        <span className="font-weight-bold">3 weeks</span>.
      </p>

      <table className="table gbtable table-hover appbox">
        <thead
          className="sticky-top bg-white shadow-sm"
          style={{ top: "56px", zIndex: 900 }}
        >
          <tr>
            <th>Metric</th>
            {weeks.map(({ users }, idx) => (
              <th key={idx}>
                <div className="font-weight-bold">Week {idx + 1}</div>
                <span>{users} Users</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.keys(weeks[0]?.metrics).map((id) => (
            <tr key={id}>
              <td>
                <MetricLabel {...weeks[0]?.metrics[id]} />
              </td>
              {weeks.map(({ metrics }) => (
                <td key={id}>{metrics[id]?.effect}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const PowerOverTime = ({
  weeks,
}: {
  weeks: PowerCalculationResults["weeks"];
}) => (
  <div className="row card gsbox mb-3 border">
    <div className="row pt-4 pl-4 pr-4 pb-1">
      <h2>Power Over Time</h2>
      <p>
        To achieve 80% power for all metrics, we advocate running your
        experiment for at least{" "}
        <span className="font-weight-bold">3 weeks</span>.
      </p>

      <table className="table gbtable table-hover appbox">
        <thead
          className="sticky-top bg-white shadow-sm"
          style={{ top: "56px", zIndex: 900 }}
        >
          <tr>
            <th>Metric</th>
            {weeks.map(({ users }, idx) => (
              <th key={idx}>
                <div className="font-weight-bold">Week {idx + 1}</div>
                <span>{users} Users</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.keys(weeks[0]?.metrics).map((id) => (
            <tr key={id}>
              <td>
                <MetricLabel {...weeks[0]?.metrics[id]} />
              </td>
              {weeks.map(({ metrics }) => (
                <td key={id}>{metrics[id]?.power}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default function PowerCalculationContent({
  results,
  updateVariations,
  clear,
  showModal,
}: {
  results: PowerCalculationResults;
  updateVariations: (_: number) => void;
  clear: () => void;
  showModal: () => void;
}) {
  return (
    <div className="contents container pagecontents ml-1 pr-4">
      <div className="row mb-4">
        <div className="col">
          <h1>Power Calculator</h1>
        </div>
      </div>
      <div className="row mb-4">
        <div className="col">
          Select key metrics and hypothesized effect size to determine ideal
          experiment duration.
        </div>
        <div className="col-auto">
          <button
            className="btn btn-link float-right text-danger"
            onClick={() => clear()}
            type="button"
          >
            Clear
          </button>
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
      <AnalysisSettings results={results} updateVariations={updateVariations} />
      <SampleSizeAndRuntime
        sampleSizeAndRuntime={results.sampleSizeAndRuntime}
      />
      <MinimumDetectableEffect weeks={results.weeks} />
      <PowerOverTime weeks={results.weeks} />
    </div>
  );
}
