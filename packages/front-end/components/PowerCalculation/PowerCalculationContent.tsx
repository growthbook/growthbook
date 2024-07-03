import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ensureAndReturn } from "@/types/utils";
import { GBHeadingArrowLeft } from "@/components/Icons";
import {
  PowerCalculationParams,
  PowerCalculationResults,
  PowerCalculationSuccessResults,
  StatsEngineSettings,
} from "./types";
import PowerCalculationStatsEngineSettingsModal from "./PowerCalculationStatsEngineSettingsModal";

const engineType = {
  frequentist: "Frequentist",
  bayesian: "Bayesian",
} as const;

const percentFormatter = (
  v: number,
  { digits }: { digits: number } = { digits: 0 }
) =>
  isNaN(v)
    ? "N/A"
    : new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: digits,
        // @ts-expect-error TS is outdated: https://caniuse.com/mdn-javascript_builtins_intl_numberformat_numberformat_options_parameter_options_roundingmode_parameter
        roundingMode: "floor",
      }).format(v);

const numberFormatter = (() => {
  const formatter = Intl.NumberFormat("en-US");
  return (v: number) => (isNaN(v) ? "N/A" : formatter.format(v));
})();

const MIN_VARIATIONS = 2;
const MAX_VARIATIONS = 12;

const formatWeeks = ({ weeks, nWeeks }: { weeks?: number; nWeeks: number }) =>
  weeks
    ? `${numberFormatter(weeks)} ${weeks > 1 ? "weeks" : "week"}`
    : `more than ${numberFormatter(nWeeks)} ${nWeeks > 1 ? "weeks" : "week"}`;

const AnalysisSettings = ({
  params,
  results,
  updateVariations,
  updateStatsEngineSettings,
}: {
  params: PowerCalculationParams;
  results: PowerCalculationResults;
  updateVariations: (_: number) => void;
  updateStatsEngineSettings: (_: StatsEngineSettings) => void;
}) => {
  const [currentVariations, setCurrentVariations] = useState<
    number | undefined
  >(params.nVariations);

  const [
    showStatsEngineSettingsModal,
    setShowStatsEngineSettingsModal,
  ] = useState(false);

  const isValidCurrentVariations =
    currentVariations &&
    MIN_VARIATIONS <= currentVariations &&
    currentVariations <= MAX_VARIATIONS;

  return (
    <>
      {showStatsEngineSettingsModal && (
        <PowerCalculationStatsEngineSettingsModal
          close={() => setShowStatsEngineSettingsModal(false)}
          params={params.statsEngineSettings}
          onSubmit={(v) => {
            updateStatsEngineSettings(v);
            setShowStatsEngineSettingsModal(false);
          }}
        />
      )}
      <div className="row card gsbox mb-3 border">
        <div className="row pt-4 pl-4 pr-4 pb-1">
          <div className="col-7">
            <h2>Analysis Settings</h2>
            <p>
              {params.nVariations} Variations ·{" "}
              {engineType[params.statsEngineSettings.type]} (Sequential Testing{" "}
              {params.statsEngineSettings.sequentialTesting
                ? "enabled"
                : "disabled"}
              ) ·{" "}
              <Link
                href="#"
                onClick={() => setShowStatsEngineSettingsModal(true)}
              >
                Edit
              </Link>
            </p>
            {results.type === "error" ? (
              <div className="alert alert-warning">
                Computation failed: {results.description}
              </div>
            ) : (
              <div className="alert alert-info w-75">
                <span className="font-weight-bold">
                  Run experiment for{" "}
                  {formatWeeks({
                    weeks: results.weekThreshold,
                    nWeeks: params.nWeeks,
                  })}
                </span>{" "}
                to achieve {percentFormatter(params.targetPower)} power for all
                metrics.
              </div>
            )}
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
                onChange={(e) =>
                  setCurrentVariations(
                    e.target.value !== "" ? Number(e.target.value) : undefined
                  )
                }
              />
              <button
                disabled={
                  currentVariations === params.nVariations ||
                  !isValidCurrentVariations
                }
                onClick={() =>
                  updateVariations(ensureAndReturn(currentVariations))
                }
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
    </>
  );
};

const MetricLabel = ({
  name,
  effectSize,
}: {
  name: string;
  effectSize: number;
}) => (
  <>
    <div className="font-weight-bold">{name}</div>
    <div className="small">
      Effect Size {percentFormatter(effectSize, { digits: 1 })}
    </div>
  </>
);

const SampleSizeAndRuntime = ({
  params,
  sampleSizeAndRuntime,
}: {
  params: PowerCalculationParams;
  sampleSizeAndRuntime: PowerCalculationSuccessResults["sampleSizeAndRuntime"];
}) => {
  const [selectedRow, setSelectedRow] = useState(
    Object.keys(sampleSizeAndRuntime)[0]
  );

  const selectedTarget = sampleSizeAndRuntime[selectedRow];
  const { name: selectedName, effectSize: selectedEffectSize } = useMemo(() => {
    const newSelectedRow = params.metrics[selectedRow]
      ? selectedRow
      : Object.keys(sampleSizeAndRuntime)[0];
    setSelectedRow(newSelectedRow);
    return ensureAndReturn(params.metrics[newSelectedRow]);
  }, [params.metrics, selectedRow, sampleSizeAndRuntime, setSelectedRow]);

  return (
    <div className="row card gsbox mb-3 border">
      <div className="row pt-4 pl-4 pr-4 pb-1">
        <div>
          <h2>Calculated Sample Size & Runtime</h2>
          <p>
            Needed sample sizes are based on total number of users across all
            variations.
          </p>
        </div>

        <div className="container">
          <div className="row">
            <div className="col-7">
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
                    const target = sampleSizeAndRuntime[id];

                    const { name, type, effectSize } = ensureAndReturn(
                      params.metrics[id]
                    );

                    return (
                      <tr
                        key={id}
                        className={clsx(
                          "power-analysis-row",
                          selectedRow === id && "selected"
                        )}
                        onClick={() => setSelectedRow(id)}
                      >
                        <td>
                          <div className="font-weight-bold">{name}</div>
                          <div className="small">
                            {type === "binomial" ? "Proportion" : "Mean"}
                          </div>
                        </td>
                        <td>{percentFormatter(effectSize, { digits: 1 })}</td>
                        <td>
                          {target
                            ? `${formatWeeks({
                                weeks: target.weeks,
                                nWeeks: params.nWeeks,
                              })}; ${numberFormatter(target.users)} users`
                            : formatWeeks({ nWeeks: params.nWeeks })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="col-4">
              <div className="card alert alert-info">
                <div className="card-title uppercase-title mb-0">Summary</div>
                <h4>{selectedName}</h4>
                <p>
                  Reliably detecting a lift of{" "}
                  <span className="font-weight-bold">
                    {percentFormatter(selectedEffectSize, { digits: 1 })}
                  </span>{" "}
                  requires running your experiment for{" "}
                  {selectedTarget ? (
                    <>
                      <span className="font-weight-bold">
                        {formatWeeks({
                          weeks: selectedTarget.weeks,
                          nWeeks: params.nWeeks,
                        })}
                      </span>{" "}
                      (collecting roughly{" "}
                      <span className="font-weight-bold">
                        {numberFormatter(selectedTarget.users)} users
                      </span>
                      )
                    </>
                  ) : (
                    <span className="font-weight-bold">
                      {formatWeeks({ nWeeks: params.nWeeks })}
                    </span>
                  )}
                </p>
              </div>
            </div>
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
      To achieve {percentFormatter(targetPower)} power for all metrics, we
      advocate running your experiment for{" "}
      <span className="font-weight-bold">
        at least {formatWeeks({ weeks: weekThreshold, nWeeks })}
      </span>
      .
    </p>
  ) : (
    <p>
      The experiment needs to run for{" "}
      <span className="font-weight-bold">{formatWeeks({ nWeeks })}</span> to
      achieve {percentFormatter(targetPower)} power for all metrics.
    </p>
  );

const MinimumDetectableEffect = ({
  results,
  params,
}: {
  results: PowerCalculationSuccessResults;
  params: PowerCalculationParams;
}) => (
  <div className="row card gsbox mb-3 border">
    <div className="row pt-4 pl-4 pr-4 pb-1">
      <div className="w-100">
        <h2>Minimum Detectable Effect Over Time</h2>
      </div>
      <WeeksThreshold
        nWeeks={params.nWeeks}
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
                    "power-analysis-cell-threshold power-analysis-overall-header-threshold"
                )}
              >
                {(() => {
                  const content = (
                    <>
                      <div className="font-weight-bold">
                        Week{` `}
                        {idx + 1}
                      </div>
                      <span className="small">
                        {numberFormatter(users)} Users
                      </span>
                    </>
                  );

                  if (results.weekThreshold === idx + 1)
                    return (
                      <Tooltip
                        popperClassName="text-top"
                        body={`Week ${
                          idx + 1
                        } is the first week when all your metrics meet their expected effect size.`}
                        tipPosition="top"
                      >
                        {content}
                      </Tooltip>
                    );

                  return content;
                })()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.keys(results.weeks[0]?.metrics).map((id, pos) => (
            <tr key={id}>
              <td>
                <MetricLabel {...ensureAndReturn(params.metrics[id])} />
              </td>
              {results.weeks.map(({ metrics }, idx) => (
                <td
                  key={`${id}-${idx}`}
                  className={clsx(
                    ensureAndReturn(metrics[id]).isThreshold &&
                      "power-analysis-cell-threshold",
                    results.weekThreshold === idx + 1 &&
                      "power-analysis-overall-cell-threshold",
                    Object.keys(results.weeks[0]?.metrics).length == pos + 1 &&
                      results.weekThreshold === idx + 1 &&
                      "power-analysis-overall-bottom-threshold"
                  )}
                >
                  {(() => {
                    const content = percentFormatter(
                      ensureAndReturn(metrics[id]).effectSize,
                      {
                        digits: 1,
                      }
                    );

                    if (ensureAndReturn(metrics[id]).isThreshold) {
                      const { effectSize, name } = ensureAndReturn(
                        params.metrics[id]
                      );
                      return (
                        <Tooltip
                          popperClassName="text-top"
                          body={`Week ${
                            idx + 1
                          } is the first week where the minimum detectable effect over time dropped below your target effect size of ${percentFormatter(
                            effectSize,
                            { digits: 1 }
                          )} for ${name}.`}
                          tipPosition="top"
                        >
                          {content}
                        </Tooltip>
                      );
                    }

                    return content;
                  })()}
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
  results: PowerCalculationSuccessResults;
}) => (
  <div className="row card gsbox mb-3 border">
    <div className="row pt-4 pl-4 pr-4 pb-1">
      <div className="w-100">
        <h2>Power Over Time</h2>
      </div>
      <WeeksThreshold
        nWeeks={params.nWeeks}
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
                    "power-analysis-cell-threshold power-analysis-overall-header-threshold"
                )}
              >
                {(() => {
                  const content = (
                    <>
                      <div className="font-weight-bold">
                        Week{` `}
                        {idx + 1}
                      </div>
                      <span className="small">
                        {numberFormatter(users)} Users
                      </span>
                    </>
                  );

                  if (results.weekThreshold === idx + 1)
                    return (
                      <Tooltip
                        popperClassName="text-top"
                        body={`Week ${
                          idx + 1
                        } is the first week when all your metrics meet their expected effect size.`}
                        tipPosition="top"
                      >
                        {content}
                      </Tooltip>
                    );

                  return content;
                })()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.keys(results.weeks[0]?.metrics).map((id, pos) => (
            <tr key={id}>
              <td>
                <MetricLabel {...ensureAndReturn(params.metrics[id])} />
              </td>
              {results.weeks.map(({ metrics }, idx) => (
                <td
                  key={`${id}-${idx}`}
                  className={clsx(
                    ensureAndReturn(metrics[id]).isThreshold &&
                      "power-analysis-cell-threshold",
                    results.weekThreshold === idx + 1 &&
                      "power-analysis-overall-cell-threshold",
                    Object.keys(results.weeks[0]?.metrics).length == pos + 1 &&
                      results.weekThreshold === idx + 1 &&
                      "power-analysis-overall-bottom-threshold"
                  )}
                >
                  {(() => {
                    const content = percentFormatter(
                      ensureAndReturn(metrics[id]).power
                    );

                    if (ensureAndReturn(metrics[id]).isThreshold) {
                      const { targetPower } = params;
                      const { effectSize, name } = ensureAndReturn(
                        params.metrics[id]
                      );
                      return (
                        <Tooltip
                          popperClassName="text-top"
                          body={`Week ${
                            idx + 1
                          } is the first week with at least ${percentFormatter(
                            targetPower
                          )} power to detect an effect size of ${percentFormatter(
                            effectSize,
                            { digits: 1 }
                          )} for ${name}.`}
                          tipPosition="top"
                        >
                          {content}
                        </Tooltip>
                      );
                    }

                    return content;
                  })()}
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
  updateStatsEngineSettings,
  edit,
  newCalculation,
}: {
  results: PowerCalculationResults;
  params: PowerCalculationParams;
  updateVariations: (_: number) => void;
  updateStatsEngineSettings: (_: StatsEngineSettings) => void;
  edit: () => void;
  newCalculation: () => void;
}) {
  return (
    <div className="contents container pagecontents ml-1 pr-4">
      <div className="row mb-4">
        <div className="col">
          <div className="d-flex justify-space-between align-items-center">
            <span className="badge badge-purple text-uppercase mr-2">
              Alpha
            </span>
            <h1>Power Calculator</h1>
          </div>
        </div>
      </div>
      <div className="row mb-4">
        <div className="col">
          Select key metrics and hypothesized effect size to determine ideal
          experiment duration.
        </div>
        <div className="col-auto pr-0">
          <button
            className="btn btn-outline-primary float-right"
            onClick={edit}
            type="button"
          >
            Edit
          </button>
        </div>
        <div className="col-auto pl-1">
          <button
            className="btn btn-primary float-right"
            onClick={() => newCalculation()}
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
        updateStatsEngineSettings={updateStatsEngineSettings}
      />
      {results.type !== "error" && (
        <>
          <SampleSizeAndRuntime
            params={params}
            sampleSizeAndRuntime={results.sampleSizeAndRuntime}
          />
          <PowerOverTime params={params} results={results} />
          <MinimumDetectableEffect params={params} results={results} />
        </>
      )}
    </div>
  );
}
