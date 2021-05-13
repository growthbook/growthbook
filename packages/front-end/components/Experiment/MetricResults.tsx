import { FC } from "react";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import {
  formatConversionRate,
  getMetricConversionTitle,
} from "../../services/metrics";
import PercentImprovementGraph from "./PercentImprovementGraph";
import { useDefinitions } from "../../services/DefinitionsContext";

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

const MetricResults: FC<{
  metric: string;
  snapshot: ExperimentSnapshotInterface;
  variationNames: string[];
}> = ({ metric, snapshot, variationNames }) => {
  const { getMetricById } = useDefinitions();
  const m = getMetricById(metric);

  if (!snapshot?.results?.[0]?.variations?.[0]?.metrics?.[metric]) {
    return (
      <div className="my-4 pb-4">
        <h5 className="metrictitle">{m.name}</h5>
        <p>
          <em>No data for this metric yet. Try updating results above.</em>
        </p>
      </div>
    );
  }

  const variations = snapshot.results[0].variations;

  // Common domain between all variations
  const domain: [number, number] = [0, 0];
  variations.forEach((v) => {
    const max = Math.max(...v.metrics[metric].buckets.map((b) => b.x));
    const min = Math.min(...v.metrics[metric].buckets.map((b) => b.x));
    if (max > domain[1]) domain[1] = max;
    if (min < domain[0]) domain[0] = min;
  });

  const baselineEnoughData = variations?.[0]?.metrics?.[metric].value > 150;

  return (
    <div className="my-4 pb-4">
      <h5 className="metrictitle">{m.name}</h5>
      <table className="table table-bordered results-table">
        <thead>
          <tr>
            <th className="align-middle">Variation</th>
            <th className="align-middle">{getMetricConversionTitle(m.type)}</th>
            <th className="align-middle">Chance to Beat Control</th>
            <th className="align-middle">
              Percent {m.inverse ? "Change" : "Improvement"}
              <div
                className="text-muted"
                style={{ fontWeight: "normal", fontSize: "0.9em" }}
              >
                95% Confidence Interval
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {variationNames.map((name, i) => {
            const stats = { ...variations[i].metrics[metric] };

            const enoughData = baselineEnoughData && stats.value > 150;

            let cn = "";
            if (stats.value <= 150) cn += " notenoughdata";
            else cn += " enoughdata";
            if (stats.chanceToWin > 0.95) cn += " winning significant";
            else if (stats.chanceToWin > 0.9) cn += " almostwinning";
            else if (stats.chanceToWin < 0.05) cn += " losing significant";
            else if (stats.chanceToWin < 0.1) cn += " almostlosing";
            if (i === 0) cn += " control";
            return (
              <tr key={name} className={`results-row ${cn}`}>
                <td className="varname">{name}</td>
                <td className="vardata text-center">
                  <strong className="result-number">
                    {formatConversionRate(m.type, stats.cr)}
                  </strong>
                  <div>
                    <small>
                      <em>
                        {numberFormatter.format(stats.value)} /{" "}
                        {numberFormatter.format(
                          stats.users || variations[i].users
                        )}
                      </em>
                    </small>
                  </div>
                </td>
                {i === 0 ? (
                  <>
                    <td>-</td>
                    <td>-</td>
                  </>
                ) : (
                  <>
                    <td className="vardata text-center">
                      {enoughData ? (
                        <span className="result-number">
                          {percentFormatter.format(stats.chanceToWin)}
                        </span>
                      ) : (
                        <em>Not enough data</em>
                      )}
                    </td>
                    <td className="vardata text-center">
                      {stats.buckets && enoughData ? (
                        <>
                          <PercentImprovementGraph
                            uid={i + metric}
                            buckets={stats.buckets}
                            expected={stats.expected}
                            ci={stats.ci}
                            inverse={m.inverse}
                            domain={domain}
                          />
                          <p className="text-center">
                            95% confident that the change is between{" "}
                            <strong>
                              {percentFormatter.format(stats.ci[0])}
                            </strong>{" "}
                            and{" "}
                            <strong>
                              {percentFormatter.format(stats.ci[1])}
                            </strong>{" "}
                            with an average of{" "}
                            <strong>
                              {percentFormatter.format(stats.expected)}
                            </strong>
                            .
                          </p>
                        </>
                      ) : (
                        "Not enough data"
                      )}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
export default MetricResults;
