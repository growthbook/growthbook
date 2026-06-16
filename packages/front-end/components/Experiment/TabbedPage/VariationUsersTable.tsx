import { ExperimentReportVariation } from "shared/types/report";
import { pValueFormatter } from "@/services/experiments";

export interface Props {
  variations: ExperimentReportVariation[];
  users: number[];
  srm?: number;
  hideVariationIndex?: boolean;
}

const numberFormatter = Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const percentFormatter = Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function VariationUsersTable({
  variations,
  users,
  srm,
  hideVariationIndex,
}: Props) {
  const totalUsers = users.reduce((sum, n) => sum + n, 0);
  const totalWeight = variations
    .map((v) => v.weight)
    .reduce((sum, n) => sum + n, 0);

  return (
    <>
      <table
        className="table mx-2 mt-0 mb-2"
        style={{ tableLayout: "fixed", width: "100%" }}
      >
        <thead>
          <tr>
            <th
              className="border-top-0"
              style={{ whiteSpace: "nowrap", width: "20%" }}
            >
              Variation
            </th>
            <th
              className="border-top-0"
              style={{ whiteSpace: "nowrap", width: "20%" }}
            >
              Actual Units
            </th>
            <th
              className="border-top-0"
              style={{ whiteSpace: "nowrap", width: "20%" }}
            >
              Expected Units
            </th>
            <th
              className="border-top-0"
              style={{ whiteSpace: "nowrap", width: "20%" }}
            >
              Actual %
            </th>
            <th
              className="border-top-0"
              style={{ whiteSpace: "nowrap", width: "20%" }}
            >
              Expected %
            </th>
          </tr>
        </thead>
        <tbody>
          {variations.map((v, i) => {
            return (
              <tr key={v.id}>
                <td
                  className={`border-right${hideVariationIndex ? "" : ` variation with-variation-label variation${v.index}`}`}
                >
                  {hideVariationIndex ? (
                    <span className="d-block text-ellipsis" title={v.name}>
                      {v.name}
                    </span>
                  ) : (
                    <div
                      className="d-flex align-items-center"
                      style={{ minWidth: 0 }}
                    >
                      <span
                        className="label"
                        style={{
                          width: 20,
                          height: 20,
                        }}
                      >
                        {v.index}
                      </span>{" "}
                      <span
                        className="text-ellipsis"
                        title={v.name}
                        style={{ flex: "1 1 auto", minWidth: 0 }}
                      >
                        {v.name}
                      </span>
                    </div>
                  )}
                </td>
                <td>
                  <b>{numberFormatter.format(users[i] || 0)}</b>
                </td>
                <td className="border-right">
                  {numberFormatter.format(
                    totalUsers * (v.weight / totalWeight) || 0,
                  )}
                </td>
                <td>
                  <b>
                    {totalUsers > 0
                      ? percentFormatter.format(users[i] / totalUsers)
                      : "-"}
                  </b>
                </td>
                <td>
                  {totalWeight > 0
                    ? percentFormatter.format(v.weight / totalWeight)
                    : "-"}
                </td>
              </tr>
            );
          })}
          {srm !== undefined && (
            <tr className="text-left">
              <td colSpan={3} className="text-nowrap text-muted">
                p-value = {pValueFormatter(srm)}
              </td>
              <td colSpan={2}></td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
