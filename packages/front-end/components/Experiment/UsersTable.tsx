import { FC, useMemo, useState } from "react";
import { FaExclamationTriangle, FaQuestionCircle } from "react-icons/fa";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import { useDefinitions } from "@/services/DefinitionsContext";
import { formatTrafficSplit } from "@/services/utils";
import Tooltip from "../Tooltip/Tooltip";
import { SRM_THRESHOLD } from "./SRMWarning";

const numberFormatter = new Intl.NumberFormat();

const UsersTable: FC<{
  results: ExperimentReportResultDimension[];
  variations: ExperimentReportVariation[];
  dimensionId: string;
}> = ({ dimensionId, results, variations }) => {
  const { getDimensionById } = useDefinitions();

  const [expand, setExpand] = useState(false);

  const dimension = useMemo(() => {
    return getDimensionById(dimensionId)?.name || "Dimension";
  }, [getDimensionById, dimensionId]);

  const hasSrm = (results || []).find((row) => row.srm < SRM_THRESHOLD);

  if (!hasSrm && !expand) {
    return (
      <div>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setExpand(true);
          }}
        >
          Show traffic allocation
        </a>
      </div>
    );
  }

  return (
    <div>
      <h2>
        Users{" "}
        {!hasSrm && (
          <a
            href="#"
            style={{ fontSize: ".8rem", fontWeight: "normal" }}
            className="ml-2"
            onClick={(e) => {
              e.preventDefault();
              setExpand(false);
            }}
          >
            hide
          </a>
        )}
      </h2>
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
      <table className="table w-auto table-bordered mb-5">
        <thead>
          <tr>
            <th>{dimension}</th>
            {variations.map((v, i) => (
              <th key={i}>{v.name}</th>
            ))}
            <th>Expected</th>
            <th>Actual</th>
            <th>SRM P-Value</th>
          </tr>
        </thead>
        <tbody>
          {(results || []).map((r, i) => (
            <tr key={i}>
              <td>{r.name || <em>unknown</em>}</td>
              {variations.map((v, i) => (
                <td key={i}>
                  {numberFormatter.format(r.variations[i]?.users || 0)}
                </td>
              ))}
              <td>
                {formatTrafficSplit(
                  variations.map((v) => v.weight),
                  1
                )}
              </td>
              <td>
                {formatTrafficSplit(
                  variations.map((v, i) => r.variations[i]?.users || 0),
                  1
                )}
              </td>
              {r.srm < SRM_THRESHOLD ? (
                <td className="bg-danger text-light">
                  <FaExclamationTriangle className="mr-1" />
                  {(r.srm || 0).toFixed(6)}
                </td>
              ) : (
                <td>{(r.srm || 0).toFixed(6)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Metrics</h2>
    </div>
  );
};
export default UsersTable;
