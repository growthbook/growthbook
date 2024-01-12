import { QueryInterface } from "back-end/types/query";

const numberFormatter = Intl.NumberFormat();

export default function OverallQueryStats({
  queries,
}: {
  queries: QueryInterface[];
}) {
  const numericStats: { [key: string]: number } = {};
  const boolStats: { [key: string]: number } = {};

  let queriesWithStats = 0;

  queries.forEach((q) => {
    if (q.statistics) {
      queriesWithStats++;
      Object.entries(q.statistics).forEach(([k, v]) => {
        if (typeof v === "number") {
          numericStats[k] = (numericStats[k] ?? 0) + v;
        } else if (typeof v === "boolean") {
          boolStats[k] = boolStats[k] || 0;
          if (v === true) {
            boolStats[k]++;
          }
        }
      });
    }
  });

  if (!queriesWithStats) return null;

  return (
    <div className="mb-4">
      <h4>Overall Query Stats</h4>
      <div className="row">
        {Object.entries(numericStats).map(([k, v]) => (
          <div className="col-auto mb-2" key={k}>
            <em>{k}</em>: <strong>{numberFormatter.format(v)}</strong>
          </div>
        ))}
        {Object.entries(boolStats).map(([k, v]) => (
          <div className="col-auto mb-2" key={k}>
            <em>{k}</em>:{" "}
            <strong>
              {v} / {queriesWithStats}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
