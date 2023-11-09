import { ExperimentReportVariation } from "back-end/types/report";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";
import clsx from "clsx";
import { SRM_THRESHOLD } from "../SRMWarning";
import Tooltip from "@/components/Tooltip/Tooltip";

export interface Props {
  variations: ExperimentReportVariation[];
  users: number[];
  srm?: number;
  hasHealthData?: boolean;
}

const numberFormatter = Intl.NumberFormat();

const percentFormatter = Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

const diffFormatter = Intl.NumberFormat(undefined, {
  signDisplay: "exceptZero",
  style: "percent",
  maximumFractionDigits: 2,
});

export default function VariationUsersTable({
  variations,
  users,
  srm,
  hasHealthData = false,
}: Props) {
  const totalUsers = users.reduce((sum, n) => sum + n, 0);
  const totalWeight = variations
    .map((v) => v.weight)
    .reduce((sum, n) => sum + n, 0);

  const showSRMWarning = !(typeof srm !== "number" || srm >= SRM_THRESHOLD);
  // const showSRMWarning = true;

  const srmFixed = srm ? parseFloat(srm.toFixed(8)) : undefined; // Should we use the p-value formatter in "@/services/experiments"?

  // Minimum number of users required to do data quality checks
  const hideSRMWarning = totalUsers < 8 * variations.length;

  return (
    <>
      <h2>Experiment Balance Check</h2>
      <table className="table mx-2 mt-0 mb-3" style={{ width: "auto" }}>
        <thead>
          <tr>
            <th className="border-top-0">Variation</th>
            <th className="border-top-0">Units</th>
            <th className="border-top-0">Expected %</th>
            <th className="border-top-0">Actual %</th>
            <th className="border-top-0">∆</th>
            <th className="border-top-0">P-Value</th>
          </tr>
        </thead>
        <tbody>
          {variations.map((v, i) => {
            const expected =
              totalWeight > 0 ? v.weight / totalWeight : undefined;
            const actual = totalUsers > 0 ? users[i] / totalUsers : undefined;

            const diff = actual && expected ? actual - expected : undefined;
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
                  {totalWeight > 0
                    ? percentFormatter.format(v.weight / totalWeight)
                    : "-"}
                </td>
                <td>
                  {totalUsers > 0
                    ? percentFormatter.format(users[i] / totalUsers)
                    : "-"}
                </td>
                <td>{diff ? diffFormatter.format(diff) : "-"}</td>
                <td
                  className={clsx(
                    {
                      "text-danger": showSRMWarning,
                      "text-success": !showSRMWarning,
                    },
                    " "
                  )}
                >
                  {srm ? srmFixed : "-"}
                  {showSRMWarning ? (
                    <Tooltip
                      body="Warning: Sample Ratio Mismatch (SRM) detected"
                      tipPosition="top"
                    >
                      {" "}
                      <FaExclamationTriangle />
                    </Tooltip>
                  ) : (
                    <Tooltip
                      body="P-value is within the expected range"
                      tipPosition="top"
                    >
                      {" "}
                      <FaCheck />
                    </Tooltip>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
