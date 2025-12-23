import { FC } from "react";
import { FaExclamationTriangle, FaQuestionCircle } from "react-icons/fa";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "shared/types/report";
import { OrganizationSettings } from "shared/types/organization";
import { DEFAULT_SRM_THRESHOLD } from "shared/constants";
import { formatTrafficSplit } from "@/services/utils";
import Tooltip from "@/components/Tooltip/Tooltip";
import { pValueFormatter } from "@/services/experiments";
import { includeVariation } from "./BreakDownResults";

const numberFormatter = new Intl.NumberFormat();

const UsersTable: FC<{
  results: ExperimentReportResultDimension[];
  variations: ExperimentReportVariation[];
  dimension: string;
  settings: OrganizationSettings;
  dimensionValuesFilter?: string[];
}> = ({ results, variations, dimension, settings, dimensionValuesFilter }) => {
  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const hasSrm = (results || []).find((row) => row.srm < srmThreshold);

  return (
    <div className="mt-1 overflow-auto">
      {hasSrm && (
        <div className="alert alert-danger">
          One or more dimensions has a Sample Ratio Mismatch (SRM){" "}
          <Tooltip
            body={`An SRM occurs when the observed traffic split is significantly different than expected. This indicates a likely bug.`}
          >
            <FaQuestionCircle />
          </Tooltip>
        </div>
      )}
      <table
        className="table mx-2 mt-0 mb-2"
        style={{ tableLayout: "fixed", width: "auto" }}
      >
        <thead>
          <tr>
            <th className="border-0 p-0"></th>
            <th
              className="border-0 p-0 text-center"
              colSpan={variations.length || 0}
            >
              Actual Units
              <hr className="mx-2 my-1" />
            </th>
            <th className="border-0 p-0 text-center" colSpan={2}>
              Traffic Split
              <hr className="mx-2 my-1" />
            </th>
          </tr>
          <tr>
            <th className="border-top-0 pt-1" style={{ minWidth: 150 }}>
              {dimension}
            </th>
            {variations.map((v, i) => (
              <th
                key={i}
                className={`border-top-0 pt-1 variation with-variation-label variation${i}`}
                style={{ minWidth: 150 }}
              >
                <div className="d-flex align-items-center">
                  <span className="label" style={{ width: 20, height: 20 }}>
                    {i}
                  </span>{" "}
                  <span
                    className="d-inline-block text-ellipsis"
                    title={v.name}
                    style={{
                      width: 100,
                    }}
                  >
                    {v.name}
                  </span>
                </div>
              </th>
            ))}
            <th className="border-top-0 pt-1" style={{ minWidth: 150 }}>
              Actual
            </th>
            <th className="border-top-0 pt-1" style={{ minWidth: 150 }}>
              Expected
            </th>
            <th className="border-top-0 pt-1" style={{ minWidth: 120 }}>
              SRM P-Value
            </th>
          </tr>
        </thead>
        <tbody>
          {(results || []).map((r, i) => {
            if (!includeVariation(r, dimensionValuesFilter)) return null;
            return (
              <tr key={i}>
                <td className="border-right">{r.name || <em>unknown</em>}</td>
                {variations.map((v, i) => (
                  <td key={i} className="pl-4">
                    {numberFormatter.format(r.variations[i]?.users || 0)}
                  </td>
                ))}
                <td className="border-left">
                  {formatTrafficSplit(
                    variations.map((v, i) => r.variations[i]?.users || 0),
                    1,
                  )}
                </td>
                <td>
                  {formatTrafficSplit(
                    variations.map((v) => v.weight),
                    1,
                  )}
                </td>

                {r.srm < srmThreshold ? (
                  <td className="bg-danger text-light border-left">
                    <FaExclamationTriangle className="mr-1" />
                    {pValueFormatter(r.srm || 0, 6)}
                  </td>
                ) : (
                  <td className="border-left">
                    {pValueFormatter(r.srm || 0, 6)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
export default UsersTable;
