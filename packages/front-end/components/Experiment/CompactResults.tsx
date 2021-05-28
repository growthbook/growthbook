import { FC } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { formatConversionRate } from "../../services/metrics";
import clsx from "clsx";
import SRMWarning from "./SRMWarning";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useDefinitions } from "../../services/DefinitionsContext";
import AlignedGraph from "./AlignedGraph";
import { formatDistance } from "date-fns";
import { MdSwapCalls } from "react-icons/md";

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

const CompactResults: FC<{
  snapshot: ExperimentSnapshotInterface;
  experiment: ExperimentInterfaceStringDates;
}> = ({ snapshot, experiment }) => {
  const { getMetricById } = useDefinitions();

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
          stats.value >= 150 &&
          variations[0].metrics[m]?.value >= 150
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
              <>
                <th colSpan={i ? 3 : 1} className="value">
                  {v.name}
                </th>
              </>
            ))}
          </tr>
          <tr>
            {experiment.variations.map((v, i) => (
              <>
                <th className={clsx("value", `variation${i} text-center`)}>
                  Value
                </th>
                {i > 0 && (
                  <th className={`variation${i} text-center`}>
                    Chance to Beat Control
                  </th>
                )}
                {i > 0 && (
                  <th className={`variation${i} text-center`}>
                    Percent Change (95% CI)
                  </th>
                )}
              </>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Users</th>
            {experiment.variations.map((v, i) => (
              <>
                <td className="value">
                  {numberFormatter.format(variations[i]?.users || 0)}
                </td>
                {i > 0 && (
                  <>
                    <td className="empty-td"></td>
                    <td className="p-0">
                      <div>
                        <AlignedGraph
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
              </>
            ))}
          </tr>
          {experiment.metrics?.map((m) => {
            const metric = getMetricById(m);
            if (!variations[0]?.metrics?.[m]) {
              return (
                <tr
                  key={m + "nodata"}
                  className={`metricrow nodata ${
                    metric.inverse ? "inverse" : ""
                  }`}
                >
                  <th className="metricname">
                    {metric.name}{" "}
                    {metric.inverse ? (
                      <div className="inverse-indicator tiptrigger">
                        <MdSwapCalls />
                        <div
                          className="tooltip bs-tooltip-bottom"
                          role="tooltip"
                          style={{
                            top: "100%",
                            left: "50%",
                            transform: "translate(-50%, 0)",
                          }}
                        >
                          <div
                            className="arrow"
                            style={{ left: "50%", marginLeft: "-0.4rem" }}
                          ></div>
                          <div
                            className="tooltip-inner"
                            style={{ minWidth: "140px" }}
                          >
                            metric is inverse, lower is better
                          </div>
                        </div>
                      </div>
                    ) : (
                      ""
                    )}
                  </th>
                  {experiment.variations.map((v, i) => {
                    const stats = { ...variations[i]?.metrics?.[m] };
                    return (
                      <>
                        <td className="variation">
                          {stats.value ? (
                            <>
                              <div className="result-number">
                                {formatConversionRate(metric.type, stats.cr)}
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
                      </>
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
                    <div className="inverse-indicator tiptrigger">
                      <MdSwapCalls />
                      <div
                        className="tooltip bs-tooltip-bottom"
                        role="tooltip"
                        style={{
                          top: "100%",
                          left: "50%",
                          transform: "translate(-50%, 0)",
                        }}
                      >
                        <div
                          className="arrow"
                          style={{ left: "50%", marginLeft: "-0.4rem" }}
                        ></div>
                        <div
                          className="tooltip-inner"
                          style={{ minWidth: "140px" }}
                        >
                          metric is inverse, lower is better
                        </div>
                      </div>
                    </div>
                  ) : (
                    ""
                  )}
                </th>
                {experiment.variations.map((v, i) => {
                  const stats = { ...variations[i].metrics[m] };
                  const ci = stats.ci || [];
                  const expected = stats.expected;

                  if (
                    Math.max(stats.value, variations[0].metrics[m]?.value) <
                      150 ||
                    Math.min(stats.value, variations[0].metrics[m]?.value) < 25
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
                      <>
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
                            <td className="variation text-center text-muted">
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
                                domain={domain}
                                axisOnly={true}
                                ci={[0, 0]}
                                significant={false}
                                showAxis={false}
                                height={70}
                                inverse={!!metric.inverse}
                              />
                            </td>
                          </>
                        )}
                      </>
                    );
                  }
                  return (
                    <>
                      <td
                        className={clsx("value", {
                          variation: i > 0,
                          won: stats.chanceToWin > 0.95,
                          lost: stats.chanceToWin < 0.05,
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
                              won: stats.chanceToWin > 0.95,
                              lost: stats.chanceToWin < 0.05,
                            }
                          )}
                        >
                          {percentFormatter.format(stats.chanceToWin)}
                        </td>
                      )}
                      {i > 0 && (
                        <td
                          className={clsx(
                            "variation compact-graph pb-0 align-middle",
                            {
                              won: stats.chanceToWin > 0.95,
                              lost: stats.chanceToWin < 0.05,
                            }
                          )}
                        >
                          <div>
                            <AlignedGraph
                              ci={ci}
                              domain={domain}
                              expected={expected}
                              significant={
                                stats.chanceToWin > 0.95 ||
                                stats.chanceToWin < 0.05
                              }
                              showAxis={false}
                              height={70}
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
