import { ExperimentReportVariation } from "back-end/types/report";

export interface Props {
  variations: ExperimentReportVariation[];
  users: number[];
}

const numberFormatter = Intl.NumberFormat();

const percentFormatter = Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function VariationUsersTable({ variations, users }: Props) {
  const totalUsers = users.reduce((sum, n) => sum + n, 0);
  const totalWeight = variations
    .map((v) => v.weight)
    .reduce((sum, n) => sum + n, 0);

  return (
    <table className="table mx-2 mt-0 mb-3" style={{ width: "auto" }}>
      <thead>
        <tr>
          <th className="border-top-0">Variation</th>
          <th className="border-top-0">Users</th>
          <th className="border-top-0">Expected %</th>
          <th className="border-top-0">Actual %</th>
        </tr>
      </thead>
      <tbody>
        {variations.map((v, i) => (
          <tr key={i}>
            <td className={`variation with-variation-label variation${i}`}>
              <div className="d-flex align-items-center">
                <span
                  className="label"
                  style={{
                    width: 20,
                    height: 20,
                  }}
                >
                  {i}
                </span>{" "}
                {v.name}
              </div>
            </td>
            <td>{numberFormatter.format(users[i] || 0)}</td>
            <td>
              {totalWeight > 0
                ? percentFormatter.format(v.weight / totalWeight)
                : "-"}
            </td>
            <td>
              {totalUsers > 0
                ? percentFormatter.format(users[i] / totalUsers)
                : "-"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
