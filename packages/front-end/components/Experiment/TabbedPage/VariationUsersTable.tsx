import { ExperimentReportVariation } from "back-end/types/report";
import clsx from "clsx";

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
                <td
                  className={clsx({
                    "text-success": diff && diff > 0,
                    "text-danger": diff && diff < 0,
                  })}
                >
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
            <tr className="text-right">
              <td colSpan={3}></td>
              <td colSpan={3} className="text-nowrap">
                <b>SRM p-value</b>
              </td>
              <td
                className={
                  isUnhealthy
                    ? "text-left text-danger font-weight-bold"
                    : "text-left"
                }
              >
                {srm}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
