import { FC, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { formatConversionRate } from "../../services/metrics";
import LinearImprovementGraph from "./LinearImprovementGraph";
import clsx from "clsx";
import SRMWarning from "./SRMWarning";
import { CgAlignLeft, CgAlignCenter } from "react-icons/cg";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useDefinitions } from "../../services/DefinitionsContext";

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

  let defaultView = "zero";
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
  // check for outlayers:
  if (
    lowerBound < -100 ||
    upperBound > 100 ||
    experiment.variations.length > 2
  ) {
    // these are probably too large to show aligned, as they'll mess up all the other lines
    defaultView = "justify";
  }

  const [alignGraphs, setAlignGraphs] = useState(defaultView);

  // change the icons depending on the alignment of the graphs:
  const alignLink =
    alignGraphs === "zero" ? <CgAlignLeft /> : <CgAlignCenter />;

  return (
    <div className="mb-4 pb-4 experiment-compact-holder">
      <SRMWarning srm={results.srm} />

      <table className="table experiment-compact">
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
                    Percent Change (95% CI){" "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (alignGraphs === "zero") {
                          setAlignGraphs("justify");
                        } else {
                          setAlignGraphs("zero");
                        }
                      }}
                      title="Change graph view"
                      style={{ fontSize: "1.2em" }}
                    >
                      {alignLink}
                    </a>
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
                {i > 0 && <td colSpan={2}></td>}
              </>
            ))}
          </tr>
          {experiment.metrics?.map((m) => {
            const metric = getMetricById(m);
            if (!variations[0]?.metrics?.[m]) {
              return (
                <tr key={m}>
                  <th>{metric.name}</th>
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
              <tr key={m}>
                <th>{metric.name}</th>
                {experiment.variations.map((v, i) => {
                  const stats = { ...variations[i].metrics[m] };

                  const ci = stats.ci || [];
                  const range = ci[1] - ci[0];
                  const losePercent =
                    ((ci[0] < 0 ? Math.abs(ci[0]) / range : 0) * 100).toFixed(
                      2
                    ) + "%";
                  const winPercent =
                    ((ci[1] > 0 ? ci[1] / range : 0) * 100).toFixed(2) + "%";
                  const expected = stats.expected;

                  if (
                    Math.max(stats.value, variations[0].metrics[m]?.value) <
                      150 ||
                    Math.min(stats.value, variations[0].metrics[m]?.value) < 25
                  ) {
                    return (
                      <>
                        <td className="value variation">
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
                        </td>
                        {i > 0 && (
                          <td colSpan={2} className="variation">
                            <small>
                              <em>not enough data</em>
                            </small>
                          </td>
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
                              {numberFormatter.format(stats.value)} /{" "}
                              {numberFormatter.format(
                                stats.users || variations[i].users
                              )}
                            </em>
                          </small>
                        </div>
                      </td>
                      {i > 0 && (
                        <td
                          className={clsx("chance variation result-number", {
                            won: stats.chanceToWin > 0.95,
                            lost: stats.chanceToWin < 0.05,
                          })}
                        >
                          {percentFormatter.format(stats.chanceToWin)}
                        </td>
                      )}
                      {i > 0 && (
                        <td
                          className={clsx("variation", {
                            won: stats.chanceToWin > 0.95,
                            lost: stats.chanceToWin < 0.05,
                          })}
                        >
                          {alignGraphs === "zero" && (
                            <div>
                              <LinearImprovementGraph
                                ci={ci}
                                domain={domain}
                                expected={expected}
                                width="100%"
                                height={60}
                              />
                            </div>
                          )}
                          {alignGraphs !== "zero" && (
                            <div className="change-container">
                              <div className="left-label">
                                {percentFormatter.format(ci[0])}
                              </div>
                              <div className="bar-holder">
                                <div
                                  className={metric.inverse ? "win" : "lose"}
                                  style={{ width: losePercent }}
                                ></div>
                                <div
                                  className={metric.inverse ? "lose" : "win"}
                                  style={{ width: winPercent }}
                                ></div>
                                <div className="expected">
                                  {percentFormatter.format(expected)}
                                </div>
                                <div className="midline" />
                              </div>
                              <div className="right-label">
                                {percentFormatter.format(ci[1])}
                              </div>
                            </div>
                          )}
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
