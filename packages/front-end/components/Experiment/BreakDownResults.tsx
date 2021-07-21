import { FC } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { formatConversionRate } from "../../services/metrics";
import { FaExclamationTriangle } from "react-icons/fa";
import ChangeBar from "./ChangeBar";
import { useDefinitions } from "../../services/DefinitionsContext";

const numberFormatter = new Intl.NumberFormat();

const BreakDownResults: FC<{
  snapshot: ExperimentSnapshotInterface;
  experiment: ExperimentInterfaceStringDates;
}> = ({ snapshot, experiment }) => {
  const { getDimensionById, getMetricById } = useDefinitions();

  const srmFailures = snapshot.results.filter((r) => r.srm <= 0.001);

  const metrics = Array.from(
    new Set(experiment.metrics.concat(experiment.guardrails || []))
  );

  return (
    <div className="mb-4 pb-4">
      {srmFailures.length > 0 && (
        <div className="mb-4">
          <h2>Users</h2>
          <div className="alert alert-danger">
            The following dimension values failed the Sample Ratio Mismatch
            (SRM) check. This means the traffic split between the variations was
            not what we expected. This is likely a bug.
          </div>
          <table className="table w-auto table-bordered">
            <thead>
              <tr>
                <th>
                  {getDimensionById(snapshot.dimension)?.name || "Dimension"}
                </th>
                {experiment.variations.map((v, i) => (
                  <th key={i}>{v.name}</th>
                ))}
                <th>SRM P-Value</th>
              </tr>
            </thead>
            <tbody>
              {srmFailures.map((r, i) => (
                <tr key={i}>
                  <td>{r.name || <em>unknown</em>}</td>
                  {experiment.variations.map((v, i) => (
                    <td key={i}>
                      {numberFormatter.format(r.variations[i]?.users || 0)}
                    </td>
                  ))}
                  <td className="bg-danger text-light">
                    <FaExclamationTriangle className="mr-1" />
                    {(r.srm || 0).toFixed(6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <hr />
          <h2>Metrics</h2>
        </div>
      )}

      <div className="alert alert-warning">
        <strong>Warning: </strong>The more dimensions and metrics you look at,
        the more likely you are to see a false positive.
      </div>
      {metrics.map((m) => {
        const metric = getMetricById(m);

        // Get overall stats for all dimension values combined
        const totalValue: number[] = [];
        const totalUsers: number[] = [];
        const improvements: number[][] = [];
        snapshot.results.forEach((r) => {
          experiment.variations.forEach((v, i) => {
            const stats = { ...r.variations[i]?.metrics?.[m] };
            totalValue[i] = totalValue[i] || 0;
            totalValue[i] += stats.value || 0;
            totalUsers[i] = totalUsers[i] || 0;
            totalUsers[i] += stats.users || 0;

            improvements[i] = improvements[i] || [];
            if (i > 0) {
              const cr = stats.cr || 0;
              const baselineCr = r?.variations?.[0]?.metrics?.[m]?.cr || 0;
              improvements[i].push(
                baselineCr > 0 ? (cr - baselineCr) / baselineCr : 0
              );
            } else {
              improvements[i].push(0);
            }
          });
        });

        // Conversion rate for the baseline
        const baselineCr =
          totalUsers[0] > 0 ? totalValue[0] / totalUsers[0] : 0;

        // Percent change for each variation
        const variationImprovements = experiment.variations.map((v, i) => {
          const cr = totalUsers[i] > 0 ? totalValue[i] / totalUsers[i] : 0;
          return baselineCr > 0 ? (cr - baselineCr) / baselineCr : 0;
        });

        const improvementMinMax = improvements.map((imp) => {
          imp.sort((a, b) => {
            return a - b;
          });
          const minMax: [number, number] = [imp[0], imp[imp.length - 1]];

          return minMax;
        });

        return (
          <div className="mb-5" key={m}>
            <h3>{metric.name}</h3>
            <div className="experiment-compact-holder">
              <table className="table w-auto experiment-compact">
                <thead>
                  <tr>
                    <th rowSpan={2} className="metric">
                      {getDimensionById(snapshot.dimension)?.name ||
                        "Dimension"}
                    </th>
                    {experiment.variations.map((v, i) => (
                      <th key={i} className="value" colSpan={i ? 2 : 1}>
                        {v.name}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {experiment.variations.map((v, i) => {
                      if (i === 0) {
                        return (
                          <th key={i} className="value variation0">
                            Value
                          </th>
                        );
                      } else {
                        return (
                          <>
                            <th
                              className={`value variation${i}`}
                              key={i + "cr"}
                            >
                              Value
                            </th>
                            <th
                              className={`variation${i}`}
                              key={i + "improvement"}
                            >
                              Change
                            </th>
                          </>
                        );
                      }
                    })}
                  </tr>
                </thead>
                <tbody>
                  <tr className="all-dimension">
                    <th>All</th>
                    {experiment.variations.map((v, i) => {
                      const cr = totalValue[i] / totalUsers[i];
                      const improvement = variationImprovements[i];
                      return (
                        <>
                          <td className="value" key={i + "_val"}>
                            <div>{formatConversionRate(metric.type, cr)}</div>
                            <div>
                              <small className="text-muted">
                                <em>
                                  {numberFormatter.format(totalValue[i])} /{" "}
                                  {numberFormatter.format(totalUsers[i])}
                                </em>
                              </small>
                            </div>
                          </td>
                          {i > 0 && (
                            <td key={i + "improvement"}>
                              <ChangeBar
                                minMax={improvementMinMax[i]}
                                change={improvement}
                                inverse={metric.inverse}
                              />
                            </td>
                          )}
                        </>
                      );
                    })}
                  </tr>
                  {snapshot.results.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name || <em>unknown</em>}</td>
                      {experiment.variations.map((v, i) => {
                        const stats = { ...r.variations[i]?.metrics?.[m] };
                        if (i === 0) {
                          return (
                            <td key={i} className="value">
                              <div>
                                {formatConversionRate(metric.type, stats.cr)}
                              </div>
                              <div>
                                <small className="text-muted">
                                  <em>
                                    {numberFormatter.format(stats.value)} /{" "}
                                    {numberFormatter.format(stats.users)}
                                  </em>
                                </small>
                              </div>
                            </td>
                          );
                        } else {
                          const cr = stats?.cr || 0;
                          const baselineCr =
                            r.variations[0]?.metrics?.[m]?.cr || 0;

                          const improvement =
                            baselineCr > 0 ? (cr - baselineCr) / baselineCr : 0;

                          return (
                            <>
                              <td className="value" key={i + "cr"}>
                                <div>
                                  {formatConversionRate(metric.type, stats.cr)}
                                </div>
                                <div>
                                  <small className="text-muted">
                                    <em>
                                      {numberFormatter.format(stats.value)} /{" "}
                                      {numberFormatter.format(stats.users)}
                                    </em>
                                  </small>
                                </div>
                              </td>
                              <td key={i + "improvement"}>
                                <ChangeBar
                                  minMax={improvementMinMax[i]}
                                  change={improvement}
                                  inverse={metric.inverse}
                                />
                              </td>
                            </>
                          );
                        }
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
};
export default BreakDownResults;
