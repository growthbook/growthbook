import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import {
  PowerCalculationParams,
  PowerCalculationResults,
} from "@/components/PowerCalculation/types";
import { ensureAndReturn } from "@/types/utils";
import { GBHeadingArrowLeft } from "@/components/Icons";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

const numberFormatter = Intl.NumberFormat("en-US");

const MIN_VARIATIONS = 2;
const MAX_VARIATIONS = 12;

const AnalysisSettings = ({
  params,
  results,
  updateVariations,
}: {
  params: PowerCalculationParams;
  results: PowerCalculationResults;
  updateVariations: (_: number) => void;
}) => {
  const [currentVariations, setCurrentVariations] = useState(
    params.nVariations
  );

  const isValidCurrentVariations =
    MIN_VARIATIONS <= currentVariations && currentVariations <= MAX_VARIATIONS;

  return (
    <div className="row card gsbox mb-3 border">
      <div className="row pt-4 pl-4 pr-4 pb-1">
        <div className="col-7">
          <h2>Analysis Settings</h2>
          <p>
            {params.nVariations} Variations · Frequentist (Sequential Testing
            enabled) · <Link href="#">Edit</Link>
          </p>
          <div className="alert alert-info w-75">
            <span className="font-weight-bold">
              Run experiment for{" "}
              {results.weekThreshold
                ? `${results.weekThreshold}`
                : `More than ${results.weeks.length}`}{" "}
              weeks
            </span>{" "}
            to achieve {percentFormatter.format(params.targetPower)} power for
            all metric.
          </div>
        </div>
        <div className="vr"></div>
        <div className="col-4 align-self-end mb-4">
          <div className="font-weight-bold mb-2"># of Variations</div>
          <div className="form-group d-flex mb-0 flex-row">
            <input
              type="number"
              className={clsx(
                "form-control w-50 mr-2",
                !isValidCurrentVariations && "border border-danger"
              )}
              value={currentVariations}
              onChange={(e) => setCurrentVariations(Number(e.target.value))}
            />
            <button
              disabled={
                currentVariations === params.nVariations ||
                !isValidCurrentVariations
              }
              onClick={() => updateVariations(currentVariations)}
              className="btn border border-primary text-primary"
            >
              Update
            </button>
          </div>
          <small
            className={clsx(
              "form-text text-muted",
              isValidCurrentVariations && "invisible"
            )}
          >
            <div className="text-danger">
              Enter a value between {MIN_VARIATIONS} - {MAX_VARIATIONS}
            </div>
          </small>
        </div>
      </div>
    </div>
  );
};

const MetricLabel = ({ name, type }: { name: string; type: string }) => (
  <>
    <div className="font-weight-bold">{name}</div>
    <div className="small">{type === "binomial" ? "Proportion" : "Mean"}</div>
  </>
);

const SampleSizeAndRuntime = ({
  params,
  sampleSizeAndRuntime,
}: {
  params: PowerCalculationParams;
  sampleSizeAndRuntime: PowerCalculationResults["sampleSizeAndRuntime"];
}) => {
  const [selectedRow, setSelectedRow] = useState(
    Object.keys(sampleSizeAndRuntime)[0]
  );

  const {
    name: selectedName,
    users: selectedUsers,
    weeks: selectedWeeks,
  } = sampleSizeAndRuntime[selectedRow];

  return (
    <div className="row card gsbox mb-3 border">
      <div className="row pt-4 pl-4 pr-4 pb-1">
        <div className="col-7">
          <h2>Calculated Sample Size & Runtime</h2>
          <p>
            Needed sample sizes are based on total number of users across all
            variations.
          </p>

          <table className="table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Effect Size</th>
                <th>Needed Sample</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(sampleSizeAndRuntime).map((id) => {
                const {
                  type,
                  users,
                  weeks,
                  effectSize,
                  name,
                } = ensureAndReturn(sampleSizeAndRuntime[id]);

                return (
                  <tr
                    key={name}
                    className={clsx(
                      "power-analysis-row",
                      selectedRow === id && "selected"
                    )}
                    onClick={() => setSelectedRow(id)}
                  >
                    <td>
                      <MetricLabel name={name} type={type} />
                    </td>
                    <td>{numberFormatter.format(effectSize)}</td>
                    <td>
                      {numberFormatter.format(weeks)} weeks;{" "}
                      {numberFormatter.format(users)} users
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="col-4 mt-4">
          <div className="card alert alert-info">
            <div className="card-title uppercase-title mb-0">Summary</div>
            <h4>{selectedName}</h4>
            <p>
              Reliably detecting a lift of{" "}
              <span className="font-weight-bold">
                {percentFormatter.format(params.targetPower)}
              </span>{" "}
              requires running your experiment for{" "}
              <span className="font-weight-bold">
                {numberFormatter.format(selectedWeeks)} weeks
              </span>{" "}
              (roughly collecting{" "}
              <span className="font-weight-bold">
                {numberFormatter.format(selectedUsers)} users
              </span>
              )
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const WeeksThreshold = ({
  nWeeks,
  targetPower,
  weekThreshold,
}: {
  nWeeks: number;
  targetPower: number;
  weekThreshold?: number;
}) =>
  weekThreshold ? (
    <p>
      To achieve {percentFormatter.format(targetPower)} power for all metrics,
      we advocate running your experiment for at least{" "}
      <span className="font-weight-bold">
        {numberFormatter.format(weekThreshold)} weeks
      </span>
      .
    </p>
  ) : (
    <p>
      The experiment needs to run for more than{" "}
      <span className="font-weight-bold">
        {numberFormatter.format(nWeeks)} weeks
      </span>{" "}
      to achieve {percentFormatter.format(targetPower)} power for all metrics.
    </p>
  );

const MinimumDetectableEffect = ({
  results,
  params,
}: {
  results: PowerCalculationResults;
  params: PowerCalculationParams;
}) => (
  <div className="row card gsbox mb-3 border">
    <div className="row pt-4 pl-4 pr-4 pb-1">
      <div className="w-100">
        <h2>Minimum Detectable Effect Over Time</h2>
      </div>
      <WeeksThreshold
        nWeeks={results.weeks.length}
        weekThreshold={results.weekThreshold}
        targetPower={params.targetPower}
      />

      <table className="table">
        <thead>
          <tr>
            <th>Metric</th>
            {results.weeks.map(({ users }, idx) => (
              <th
                key={idx}
                className={clsx(
                  results.weekThreshold === idx + 1 &&
                    "power-analysis-cell-threshold"
                )}
              >
                <div className="font-weight-bold">Week {idx + 1}</div>
                <span className="small">
                  {numberFormatter.format(users)} Users
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.keys(results.weeks[0]?.metrics).map((id) => (
            <tr key={id}>
              <td>
                <MetricLabel {...results.weeks[0]?.metrics[id]} />
              </td>
              {results.weeks.map(({ metrics }, idx) => (
                <td
                  key={`${id}-${idx}`}
                  className={clsx(
                    ensureAndReturn(metrics[id]).isThreshold &&
                      "power-analysis-cell-threshold"
                  )}
                >
                  {numberFormatter.format(
                    ensureAndReturn(metrics[id]).effectSize
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const PowerOverTime = ({
  params,
  results,
}: {
  params: PowerCalculationParams;
  results: PowerCalculationResults;
}) => (
  <div className="row card gsbox mb-3 border">
    <div className="row pt-4 pl-4 pr-4 pb-1">
      <div className="w-100">
        <h2>Power Over Time</h2>
      </div>
      <WeeksThreshold
        nWeeks={results.weeks.length}
        weekThreshold={results.weekThreshold}
        targetPower={params.targetPower}
      />

      <table className="table">
        <thead>
          <tr>
            <th>Metric</th>
            {results.weeks.map(({ users }, idx) => (
              <th
                key={idx}
                className={clsx(
                  results.weekThreshold === idx + 1 &&
                    "power-analysis-cell-threshold"
                )}
              >
                <div className="font-weight-bold">Week {idx + 1}</div>
                <span className="small">
                  {numberFormatter.format(users)} Users
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.keys(results.weeks[0]?.metrics).map((id) => (
            <tr key={id}>
              <td>
                <MetricLabel {...results.weeks[0]?.metrics[id]} />
              </td>
              {results.weeks.map(({ metrics }, idx) => (
                <td
                  key={`${id}-${idx}`}
                  className={clsx(
                    ensureAndReturn(metrics[id]).isThreshold &&
                      "power-analysis-cell-threshold"
                  )}
                >
                  {percentFormatter.format(ensureAndReturn(metrics[id]).power)}
                </td>
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
  params,
  updateVariations,
  clear,
  showModal,
}: {
  results: PowerCalculationResults;
  params: PowerCalculationParams;
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
            <span className="h4 pr-2 m-0 d-inline-block align-top">
              <GBHeadingArrowLeft />
            </span>
            New Calculation
          </button>
        </div>
      </div>
      <AnalysisSettings
        params={params}
        results={results}
        updateVariations={updateVariations}
      />
      <SampleSizeAndRuntime
        params={params}
        sampleSizeAndRuntime={results.sampleSizeAndRuntime}
      />
      <MinimumDetectableEffect params={params} results={results} />
      <PowerOverTime params={params} results={results} />
    </div>
  );
}
