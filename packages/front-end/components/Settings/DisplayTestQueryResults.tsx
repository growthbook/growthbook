import React from "react";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";

export type Results = {
  success?: string;
  error?: string;
  warnings?: string[];
};

type Props = {
  results: Results;
};

export default function DisplayTestQueryResults({ results }: Props) {
  if (results?.error) {
    return <div className="mt-3 alert alert-danger">{results.error}</div>;
  }

  return (
    <div className="pt-3">
      {results?.success && (
        <div className="alert alert-success">
          <FaCheck />
          <span className="pl-2">{results.success}</span>
        </div>
      )}
      {results?.warnings?.length > 0 &&
        results.warnings.map((warning) => {
          return (
            <div className="alert alert-warning" key={warning}>
              <div className="d-flex align-items-center">
                <FaExclamationTriangle />
                <span className="pl-2">{warning}</span>
              </div>
            </div>
          );
        })}
    </div>
  );
}
