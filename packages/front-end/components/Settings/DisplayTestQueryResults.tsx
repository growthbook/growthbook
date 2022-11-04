import React, { useState } from "react";
import { ExposureQuery } from "back-end/types/datasource";
import { UseFormReturn } from "react-hook-form";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";

export type Results = {
  success?: string;
  error?: string;
  warnings?: { type: string; message: string; optionalColumns?: string[] }[];
};

type Props = {
  results: Results;
  form?: UseFormReturn<ExposureQuery>;
};

export default function DisplayTestQueryResults({ results, form }: Props) {
  const [disableAddDimensionBtn, setDisableAddDimensionBtn] = useState(false);
  const dimensions = form?.watch("dimensions");

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
            <div className="alert alert-warning" key={warning.message}>
              <div className="d-flex align-items-center">
                <FaExclamationTriangle />
                <span className="pl-2">{warning.message}</span>
                {warning.type === "optionalColumns" && dimensions && (
                  <button
                    disabled={disableAddDimensionBtn}
                    onClick={(e) => {
                      e.preventDefault();
                      setDisableAddDimensionBtn(true);
                      form.setValue("dimensions", [
                        ...dimensions,
                        ...warning.optionalColumns,
                      ]);
                    }}
                    className="btn btn-link"
                  >
                    {`Add Dimension${
                      warning.optionalColumns.length > 1 ? "s" : ""
                    }`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}
