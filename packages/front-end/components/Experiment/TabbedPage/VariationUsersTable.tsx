import { ExperimentReportVariation } from "back-end/types/report";

export interface Props {
  variations: ExperimentReportVariation[];
  users: number[];
  srm?: string;
  isUnhealthy?: boolean;
}

const numberFormatter = Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const percentFormatter = Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

const diffFormatter = Intl.NumberFormat(undefined, {
  signDisplay: "exceptZero",
  maximumFractionDigits: 2,
});

export default function VariationUsersTable({
  variations,
  users,
  srm,
  isUnhealthy,
}: Props) {
  const totalUsers = users.reduce((sum, n) => sum + n, 0);
  const totalWeight = variations
    .map((v) => v.weight)
    .reduce((sum, n) => sum + n, 0);

  return (
    <>
      <table className="table mx-2 mt-0 mb-3" style={{ width: "auto" }}>
        <thead>
          <tr>
            <th className="border-top-0 border-bottom-0" colSpan={1}></th>
            <th className="border-top-0 text-center" colSpan={2}>
              Units
            </th>
            <th className="border-top-0 border-bottom-0" colSpan={0}></th>
            <th className="border-top-0 text-center" colSpan={3}>
              %
            </th>
          </tr>
          <tr>
            <th className="border-top-0">Variation</th>
            <th className="border-top-0">Actual</th>
            <th className="border-top-0">Expected</th>
            <th className="border-top-0"></th>
            <th className="border-top-0">Actual</th>
            <th className="border-top-0">Expected</th>
            <th className="border-top-0">∆</th>
          </tr>
        </thead>
        <tbody>
          {variations.map((v, i) => {
            const expected =
              totalWeight > 0 ? v.weight / totalWeight : undefined;
            const actual = totalUsers > 0 ? users[i] / totalUsers : undefined;

            const diff =
              actual && expected ? (actual - expected) * 100 : undefined;

            let diffColor;

            if (diff && diff < 0) {
              diffColor = "lightcoral";
            } else if (diff && diff > 0) {
              diffColor = "lightgreen";
            }

            return (
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
                  {numberFormatter.format(
                    totalUsers * (v.weight / totalWeight) || 0
                  )}
                </td>
                <td></td>
                <td>
                  {totalUsers > 0
                    ? percentFormatter.format(users[i] / totalUsers)
                    : "-"}
                </td>
                <td>
                  {totalWeight > 0
                    ? percentFormatter.format(v.weight / totalWeight)
                    : "-"}
                </td>
                <td style={diffColor ? { color: diffColor } : undefined}>
                  {diff ? (
                    <b>
                      {diffFormatter.format(diff)}
                      <sub>pp</sub>
                    </b>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            );
          })}
          {srm && (
            <tr>
              <td></td>
              <td></td>
              <td>
                <b>SRM p-value</b>
              </td>
              <td></td>
              <td
                className={
                  isUnhealthy ? "text-danger font-weight-bold" : undefined
                }
              >
                {srm}
              </td>
              <td></td>
              <td></td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
