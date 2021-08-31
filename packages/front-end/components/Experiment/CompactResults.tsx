import React, { FC, Fragment } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  formatConversionRate,
  defaultWinRiskThreshold,
  defaultLoseRiskThreshold,
  defaultMinConversionThresholdDisplay,
  defaultMinConversionThresholdSignificance,
} from "../../services/metrics";
import clsx from "clsx";
import SRMWarning from "./SRMWarning";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useDefinitions } from "../../services/DefinitionsContext";
import AlignedGraph from "./AlignedGraph";
import { formatDistance } from "date-fns";
import { MdSwapCalls } from "react-icons/md";
import Tooltip from "../Tooltip";
import useConfidenceLevels from "../../hooks/useConfidenceLevels";
import { FaQuestionCircle } from "react-icons/fa";
import { useState } from "react";
import isEqual from "lodash/isEqual";

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function hasEnoughData(
  value1: number,
  value2: number,
  displayThreshold: number = defaultMinConversionThresholdDisplay,
  sigThreshold: number = defaultMinConversionThresholdSignificance
): boolean {
  return (
    Math.max(value1, value2) >= sigThreshold &&
    Math.min(value1, value2) >= displayThreshold
  );
}

const CompactResults: FC<{
  snapshot: ExperimentSnapshotInterface;
  experiment: ExperimentInterfaceStringDates;
  barFillType?: "gradient" | "significant";
  barType?: "pill" | "violin";
}> = ({
  snapshot,
  experiment,
  barFillType = "gradient",
  barType = "violin",
}) => {
  const { getMetricById } = useDefinitions();
  const { ciUpper, ciLower } = useConfidenceLevels();

  const results = snapshot.results[0];
  const variations = results?.variations || [];

  const [riskVariation, setRiskVariation] = useState(() => {
    // Calculate the total risk for each variation across all metrics
    const sums: number[] = Array(variations.length).fill(0);
    experiment.metrics.forEach((m) => {
      const metric = getMetricById(m);
      if (!metric) return;

      const minThresholdDisplay =
        metric?.minThresholdDisplay ?? defaultMinConversionThresholdDisplay;
      const minThresholdSignificance =
        metric?.minThresholdDisplay ??
        defaultMinConversionThresholdSignificance;
      let controlMax = 0;
      const controlCR = variations[0].metrics[m]?.cr;
      if (!controlCR) return;
      variations.forEach((v, i) => {
        if (!i) return;
        if (
          !hasEnoughData(
            v.metrics[m]?.value,
            variations[0].metrics[m]?.value,
            minThresholdDisplay,
            minThresholdSignificance
          )
        ) {
          return;
        }
        const risk = v.metrics[m]?.risk;
        const cr = v.metrics[m]?.cr;
        if (!risk) return;

        const controlRisk = (metric.inverse ? risk[1] : risk[0]) / controlCR;
        controlMax = Math.max(controlMax, controlRisk);

        sums[i] += (metric.inverse ? risk[0] : risk[1]) / cr;
      });
      sums[0] += controlMax;
    });

    // Default to the variation with the lowest total risk
    return sums.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])[0][1];
  });

  let lowerBound: number, upperBound: number;
  const domain: [number, number] = [0, 0];
  experiment.metrics?.map((m) => {
    const metric = getMetricById(m);
    const minThresholdDisplay =
      metric?.minThresholdDisplay ?? defaultMinConversionThresholdDisplay;
    const minThresholdSignificance =
      metric?.minThresholdDisplay ?? defaultMinConversionThresholdSignificance;

    experiment.variations?.map((v, i) => {
      if (variations[i]?.metrics?.[m]) {
        const stats = { ...variations[i].metrics[m] };
        if (
          i > 0 &&
          hasEnoughData(
            stats.value,
            variations[0].metrics[m]?.value || 0,
            minThresholdDisplay,
            minThresholdSignificance
          )
        ) {
          const ci = stats.ci || [];
          if (!lowerBound || ci[0] < lowerBound) lowerBound = ci[0];
          if (!upperBound || ci[1] > upperBound) upperBound = ci[1];
        }
      }
    });
  });
  // calculate domain
  domain[0] = lowerBound;
  domain[1] = upperBound;

  const hasRisk =
    Object.values(variations[1]?.metrics || {}).filter(
      (x) => x.risk?.length > 0
    ).length > 0;

  // Variations defined for the experiment
  const definedVariations: string[] = experiment.variations
    .map((v, i) => v.key || i + "")
    .sort();
  // Variation ids returned from the query
  const returnedVariations: string[] = variations
    .map((v, i) => {
      return {
        variation: experiment.variations[i]?.key || i + "",
        hasData: v.users > 0,
      };
    })
    .filter((v) => v.hasData)
    .map((v) => v.variation)
    .concat(snapshot?.unknownVariations || [])
    .sort();

  const unequalVariations = !isEqual(returnedVariations, definedVariations);
  const variationMismatch =
    (experiment.datasource && snapshot?.unknownVariations?.length > 0) ||
    unequalVariations;

  return (
    <div className="mb-4 experiment-compact-holder">
      {variationMismatch && (
        <div className="alert alert-danger">
          <h4 className="font-weight-bold">Variation Id Mismatch</h4>
          {unequalVariations ? (
            <div>
              <div className="mb-1">
                Returned from data source:
                {returnedVariations.map((v) => (
                  <code className="mx-2" key={v}>
                    {v}
                  </code>
                ))}
              </div>
              <div>
                Defined in Growth Book:
                {definedVariations.map((v) => (
                  <code className="mx-2" key={v}>
                    {v}
                  </code>
                ))}
              </div>
            </div>
          ) : (
            <div>All problems fixed. Update Data to refresh the results.</div>
          )}
        </div>
      )}

      {!variationMismatch && <SRMWarning srm={results.srm} />}

      <table className={`table experiment-compact aligned-graph`}>
        <thead>
          <tr>
            <th rowSpan={2} className="metric" style={{ minWidth: 125 }}>
              Metric
            </th>
            {hasRisk && (
              <th
                rowSpan={2}
                className="metric"
                style={{ maxWidth: 142, minWidth: 125 }}
              >
                Risk of Choosing&nbsp;
                <Tooltip text="How much you are likely to lose if you choose this variation and it's actually worse">
                  <FaQuestionCircle />
                </Tooltip>
                <div className="mt-1">
                  <select
                    className="form-control form-control-sm"
                    style={{ maxWidth: 150 }}
                    value={riskVariation}
                    onChange={(e) => {
                      setRiskVariation(parseInt(e.target.value));
                    }}
                  >
                    {experiment.variations.map((v, i) => (
                      <option key={v.name} value={i}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              </th>
            )}
            {experiment.variations.map((v, i) => (
              <th colSpan={i ? 3 : 1} className="value" key={i}>
                {v.name}
              </th>
            ))}
          </tr>
          <tr>
            {experiment.variations.map((v, i) => (
              <React.Fragment key={i}>
                <th className={clsx("value", `variation${i} text-center`)}>
                  Value
                </th>
                {i > 0 && (
                  <th
                    className={`variation${i} text-center`}
                    style={{ minWidth: 110 }}
                  >
                    Chance to Beat Control
                  </th>
                )}
                {i > 0 && (
                  <th className={`variation${i} text-center`}>
                    Percent Change{" "}
                    {barType === "violin" && hasRisk && (
                      <Tooltip text="The true value is more likely to be in the thicker parts of the graph">
                        <FaQuestionCircle />
                      </Tooltip>
                    )}
                  </th>
                )}
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Users</th>
            {hasRisk && <th className="empty-td"></th>}
            {experiment.variations.map((v, i) => (
              <React.Fragment key={i}>
                <td className="value">
                  {numberFormatter.format(variations[i]?.users || 0)}
                </td>
                {i > 0 && (
                  <>
                    <td className="empty-td"></td>
                    <td className="p-0">
                      <div>
                        <AlignedGraph
                          id={experiment.id + "_" + i + "_axis"}
                          domain={domain}
                          significant={true}
                          showAxis={true}
                          axisOnly={true}
                          //width="100%"
                          height={50}
                        />
                      </div>
                    </td>
                  </>
                )}
              </React.Fragment>
            ))}
          </tr>
          {experiment.metrics?.map((m) => {
            const metric = getMetricById(m);
            if (!metric || !variations[0]?.metrics?.[m]) {
              return (
                <tr
                  key={m + "nodata"}
                  className={`metricrow nodata ${
                    metric?.inverse ? "inverse" : ""
                  }`}
                >
                  <th className="metricname">
                    {metric?.name}{" "}
                    {metric?.inverse ? (
                      <Tooltip
                        text="metric is inverse, lower is better"
                        className="inverse-indicator"
                      >
                        <MdSwapCalls />
                      </Tooltip>
                    ) : (
                      ""
                    )}
                  </th>
                  {hasRisk && <th className="empty-td"></th>}
                  {experiment.variations.map((v, i) => {
                    const stats = { ...variations[i]?.metrics?.[m] };
                    return (
                      <React.Fragment key={i}>
                        <td className="value variation">
                          {stats.value ? (
                            <>
                              <div className="result-number">
                                {formatConversionRate(metric?.type, stats.cr)}
                              </div>
                              <div>
                                <small className="text-muted">
                                  <em>
                                    {numberFormatter.format(stats.value)} /{" "}
                                    {numberFormatter.format(
                                      stats.users || variations[i].users
                                    )}
                                  </em>
                                </small>
                              </div>
                            </>
                          ) : (
                            <em>no data</em>
                          )}
                        </td>
                        {i > 0 && <td colSpan={2} className="variation"></td>}
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            }

            let risk: number;
            let riskCR: number;
            let relativeRisk: number;
            let showRisk = false;
            const winRiskThreshold = metric?.winRisk || defaultWinRiskThreshold;
            const loseRiskThreshold =
              metric?.loseRisk || defaultLoseRiskThreshold;
            const minThresholdDisplay =
              metric?.minThresholdDisplay ??
              defaultMinConversionThresholdDisplay;
            const minThresholdSignificance =
              metric?.minThresholdDisplay ??
              defaultMinConversionThresholdSignificance;
            if (hasRisk) {
              if (riskVariation > 0) {
                risk =
                  variations[riskVariation]?.metrics?.[m]?.risk?.[
                    metric.inverse ? 0 : 1
                  ];
                riskCR = variations[riskVariation]?.metrics?.[m]?.cr;
                showRisk =
                  risk !== null &&
                  riskCR > 0 &&
                  hasEnoughData(
                    variations[riskVariation]?.metrics?.[m]?.value,
                    variations[0]?.metrics?.[m]?.value,
                    minThresholdDisplay,
                    minThresholdSignificance
                  );
              } else {
                risk = -1;
                variations.forEach((v, i) => {
                  if (!i) return;
                  if (
                    !hasEnoughData(
                      v.metrics[m]?.value,
                      variations[0].metrics[m]?.value,
                      minThresholdDisplay,
                      minThresholdSignificance
                    )
                  ) {
                    return;
                  }
                  const vRisk = v.metrics?.[m]?.risk?.[metric.inverse ? 1 : 0];
                  if (vRisk > risk) {
                    risk = vRisk;
                    riskCR = v.metrics?.[m]?.cr;
                  }
                });
                showRisk = risk >= 0 && riskCR > 0;
              }
              if (showRisk) {
                relativeRisk = risk / riskCR;
              }
            }

            return (
              <tr
                key={m}
                className={`metricrow ${metric.inverse ? "inverse" : ""}`}
              >
                <th className="metricname">
                  {metric.name}{" "}
                  {metric.inverse ? (
                    <Tooltip
                      text="metric is inverse, lower is better"
                      className="inverse-indicator"
                    >
                      <MdSwapCalls />
                    </Tooltip>
                  ) : (
                    ""
                  )}
                </th>
                {hasRisk && (
                  <td
                    className={clsx("chance variation", {
                      won: showRisk && relativeRisk <= winRiskThreshold,
                      lost: showRisk && relativeRisk >= loseRiskThreshold,
                      warning:
                        showRisk &&
                        relativeRisk > winRiskThreshold &&
                        relativeRisk < loseRiskThreshold,
                    })}
                  >
                    {showRisk ? (
                      <>
                        <div className="result-number">
                          {percentFormatter.format(relativeRisk)}
                        </div>
                        {metric.type !== "binomial" && (
                          <div>
                            <small className="text-muted">
                              <em>
                                {formatConversionRate(metric.type, risk)}
                                &nbsp;/&nbsp;user
                              </em>
                            </small>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="badge badge-pill badge-warning">
                        not enough data
                      </div>
                    )}
                  </td>
                )}
                {experiment.variations.map((v, i) => {
                  const stats = { ...variations[i].metrics[m] };
                  const ci = stats.ci || [];
                  const expected = stats.expected;

                  if (
                    !hasEnoughData(
                      stats.value,
                      variations[0].metrics[m]?.value || 0,
                      minThresholdDisplay,
                      minThresholdSignificance
                    )
                  ) {
                    const percentComplete = Math.min(
                      Math.max(stats.value, variations[0].metrics[m]?.value) /
                        minThresholdSignificance,
                      Math.min(stats.value, variations[0].metrics[m]?.value) /
                        minThresholdDisplay
                    );
                    const phaseStart = new Date(
                      experiment.phases[snapshot.phase]?.dateStarted
                    ).getTime();
                    const snapshotCreated = new Date(
                      snapshot.dateCreated
                    ).getTime();

                    const msRemaining =
                      percentComplete > 0.1
                        ? ((snapshotCreated - phaseStart) *
                            (1 - percentComplete)) /
                            percentComplete -
                          (Date.now() - snapshotCreated)
                        : null;

                    const showTimeRemaining =
                      msRemaining !== null &&
                      snapshot.phase === experiment.phases.length - 1 &&
                      experiment.status === "running";

                    return (
                      <Fragment key={i}>
                        <td className="value variation">
                          <div className="result-number">
                            {formatConversionRate(metric.type, stats.cr)}
                          </div>
                          <div>
                            <small className="text-muted">
                              <em>
                                {numberFormatter.format(stats.value)}
                                &nbsp;/&nbsp;
                                {numberFormatter.format(
                                  stats.users || variations[i].users
                                )}
                              </em>
                            </small>
                          </div>
                        </td>
                        {i > 0 && (
                          <>
                            <td
                              className="variation text-center text-muted"
                              colSpan={1}
                            >
                              <div>
                                <div className="badge badge-pill badge-warning">
                                  not enough data
                                </div>
                                {showTimeRemaining && (
                                  <div className="font-italic mt-1">
                                    {msRemaining > 0 ? (
                                      <>
                                        <span className="nowrap">
                                          {formatDistance(0, msRemaining)}
                                        </span>{" "}
                                        left
                                      </>
                                    ) : (
                                      "try updating now"
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="variation compact-graph pb-0 align-middle">
                              <AlignedGraph
                                id={experiment.id + "_" + i + "_" + m}
                                domain={domain}
                                axisOnly={true}
                                ci={[0, 0]}
                                significant={false}
                                showAxis={false}
                                height={62}
                                inverse={!!metric.inverse}
                              />
                            </td>
                          </>
                        )}
                      </Fragment>
                    );
                  }
                  return (
                    <Fragment key={i}>
                      <td
                        className={clsx("value align-middle", {
                          variation: i > 0,
                          won:
                            barFillType === "significant" &&
                            stats.chanceToWin > ciUpper,
                          lost:
                            barFillType === "significant" &&
                            stats.chanceToWin < ciLower,
                        })}
                      >
                        <div className="result-number">
                          {formatConversionRate(metric.type, stats.cr)}
                        </div>
                        <div>
                          <small className="text-muted">
                            <em>
                              {numberFormatter.format(stats.value)}&nbsp;/&nbsp;
                              {numberFormatter.format(
                                stats.users || variations[i].users
                              )}
                            </em>
                          </small>
                        </div>
                      </td>
                      {i > 0 && (
                        <td
                          className={clsx(
                            "chance variation result-number align-middle",
                            {
                              won: stats.chanceToWin > ciUpper,
                              lost: stats.chanceToWin < ciLower,
                            }
                          )}
                        >
                          {percentFormatter.format(stats.chanceToWin)}
                        </td>
                      )}
                      {i > 0 && (
                        <td
                          className={clsx("compact-graph pb-0 align-middle", {
                            variation: barFillType === "significant",
                            won:
                              barFillType === "significant" &&
                              stats.chanceToWin > ciUpper,
                            lost:
                              barFillType === "significant" &&
                              stats.chanceToWin < ciLower,
                          })}
                        >
                          <div>
                            <AlignedGraph
                              ci={ci}
                              uplift={stats.uplift}
                              id={experiment.id + "_" + i + "_" + m}
                              domain={domain}
                              expected={expected}
                              barType={barType}
                              barFillType={barFillType}
                              significant={
                                stats.chanceToWin > ciUpper ||
                                stats.chanceToWin < ciLower
                              }
                              showAxis={false}
                              height={62}
                              inverse={!!metric.inverse}
                            />
                          </div>
                        </td>
                      )}
                    </Fragment>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
export default CompactResults;
