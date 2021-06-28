import React, { FC, Fragment } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { formatConversionRate } from "../../services/metrics";
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

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function hasEnoughData(value1: number, value2: number): boolean {
  return Math.max(value1, value2) >= 150 && Math.min(value1, value2) >= 25;
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

  let lowerBound: number, upperBound: number;
  const domain: [number, number] = [0, 0];
  experiment.metrics?.map((m) => {
    experiment.variations?.map((v, i) => {
      if (variations[i]?.metrics?.[m]) {
        const stats = { ...variations[i].metrics[m] };
        if (
          i > 0 &&
          hasEnoughData(stats.value, variations[0].metrics[m]?.value || 0)
        ) {
          const ci = stats.ci || [];
          if (!lowerBound || ci[0] < lowerBound) lowerBound = ci[0];
          if (!upperBound || ci[1] > upperBound) upperBound = ci[1];
        }
      }
    });
  });
  // store domaine for rechart
  domain[0] = lowerBound;
  domain[1] = upperBound;

  const hasRisk =
    Object.values(variations[1]?.metrics || {}).filter(
      (x) => x.risk?.length > 0
    ).length > 0;

  const showControlRisk: boolean = hasRisk && false;

  return (
    <div className="mb-4 pb-4 experiment-compact-holder">
      <SRMWarning srm={results.srm} />

      <table className={`table experiment-compact aligned-graph`}>
        <thead>
          <tr>
            <th rowSpan={2} className="metric">
              Metric
            </th>
            {experiment.variations.map((v, i) => (
              <th
                colSpan={i ? (hasRisk ? 4 : 3) : showControlRisk ? 2 : 1}
                className="value"
                key={i}
              >
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
                {showControlRisk && i == 0 && (
                  <th className={`variation${i} text-center`}>
                    Risk&nbsp;
                    <Tooltip text="How much you will lose if you choose the Control and you are wrong">
                      <FaQuestionCircle />
                    </Tooltip>
                  </th>
                )}
                {i > 0 && (
                  <th className={`variation${i} text-center`}>
                    Chance to Beat Control
                  </th>
                )}
                {hasRisk && i > 0 && (
                  <>
                    <th className={`variation${i} text-center`}>
                      Risk&nbsp;
                      <Tooltip text="How much you will lose if you choose this Variation and you are wrong">
                        <FaQuestionCircle />
                      </Tooltip>
                    </th>
                  </>
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
            {experiment.variations.map((v, i) => (
              <React.Fragment key={i}>
                <td className="value">
                  {numberFormatter.format(variations[i]?.users || 0)}
                </td>
                {i === 0 && showControlRisk && <td className="empty-td"></td>}
                {i > 0 && (
                  <>
                    <td className="empty-td"></td>
                    {hasRisk && <td className="empty-td"></td>}
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
                  {experiment.variations.map((v, i) => {
                    const stats = { ...variations[i]?.metrics?.[m] };
                    return (
                      <React.Fragment key={i}>
                        <td className="variation">
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
                        {showControlRisk && <td className="empty-td"></td>}
                        {i > 0 && (
                          <td
                            colSpan={hasRisk ? 3 : 2}
                            className="variation"
                          ></td>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
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
                {experiment.variations.map((v, i) => {
                  const stats = { ...variations[i].metrics[m] };
                  const ci = stats.ci || [];
                  const expected = stats.expected;

                  if (
                    !hasEnoughData(
                      stats.value,
                      variations[0].metrics[m]?.value || 0
                    )
                  ) {
                    const percentComplete = Math.min(
                      Math.max(stats.value, variations[0].metrics[m]?.value) /
                        150,
                      Math.min(stats.value, variations[0].metrics[m]?.value) /
                        25
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
                        {i === 0 && showControlRisk && (
                          <td className="empty-td"></td>
                        )}
                        {i > 0 && (
                          <>
                            <td
                              className="variation text-center text-muted"
                              colSpan={hasRisk ? 2 : 1}
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
                    <>
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
                      {i === 0 && showControlRisk && (
                        <td className={clsx("align-middle")}>
                          <div className="result-number">
                            {percentFormatter.format(
                              Math.max(
                                ...variations.map((v) => {
                                  const data = v.metrics[m];
                                  if (!data || !data.risk || !data.risk.length)
                                    return 0;
                                  return metric.inverse
                                    ? data.risk[1]
                                    : data.risk[0];
                                })
                              ) / stats.cr
                            )}
                          </div>
                          {metric.type !== "binomial" && (
                            <div>
                              <small className="text-muted">
                                <em>
                                  {formatConversionRate(
                                    metric.type,
                                    Math.max(
                                      ...variations.map((v) => {
                                        const data = v.metrics[m];
                                        if (
                                          !data ||
                                          !data.risk ||
                                          !data.risk.length
                                        )
                                          return 0;
                                        return metric.inverse
                                          ? data.risk[1]
                                          : data.risk[0];
                                      })
                                    )
                                  )}
                                  &nbsp;/&nbsp;user
                                </em>
                              </small>
                            </div>
                          )}
                        </td>
                      )}
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
                      {hasRisk && i > 0 && (
                        <td
                          className={clsx("align-middle", {
                            won:
                              barFillType === "significant" &&
                              stats.chanceToWin > ciUpper,
                            lost:
                              barFillType === "significant" &&
                              stats.chanceToWin < ciLower,
                          })}
                        >
                          {(!metric.inverse && stats.risk[1] < stats.risk[0]) ||
                          (metric.inverse && stats.risk[0] < stats.risk[1]) ? (
                            <>
                              <div className="result-number">
                                {percentFormatter.format(
                                  (metric.inverse
                                    ? stats.risk[0]
                                    : stats.risk[1]) / stats.cr
                                )}
                              </div>

                              {metric.type !== "binomial" && (
                                <div>
                                  <small className="text-muted">
                                    <em>
                                      {formatConversionRate(
                                        metric.type,
                                        metric.inverse
                                          ? stats.risk[0]
                                          : stats.risk[1]
                                      )}
                                      &nbsp;/&nbsp;user
                                    </em>
                                  </small>
                                </div>
                              )}
                            </>
                          ) : (
                            ""
                          )}
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
                    </>
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
