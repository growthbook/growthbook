import React from "react";
import { TestQueryRow } from "back-end/src/types/Integration";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";

export type TestQueryResults = {
  status: number;
  optionalColumns?: string[];
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
  includesNamedColumns: boolean;
};

type Props = {
  testQueryResults: TestQueryResults | null;
  // eslint-disable-next-line
  form?: any;
};

export default function DisplayTestQueryResults({
  testQueryResults,
  form,
}: Props) {
  let columns = [];

  if (testQueryResults?.results?.length > 0) {
    columns = Object.keys(testQueryResults.results[0]);
  }

  const dimensions = form.watch("dimensions");

  return (
    <div className="pt-3">
      {testQueryResults?.duration && (
        <div className="alert alert-success">
          <FaCheck />
          <span className="pl-2">
            {`The query ran successfully in ${testQueryResults.duration} MS.`}
            {testQueryResults?.results.length === 0 &&
              " However, no rows were returned."}
          </span>
        </div>
      )}
      {testQueryResults?.optionalColumns?.length > 0 && (
        <div className="alert alert-warning">
          <div className="d-flex align-items-center">
            <FaExclamationTriangle />
            <span className="pl-2">
              The column{testQueryResults.optionalColumns.length > 1 && "s "}{" "}
              listed below{" "}
              {testQueryResults.optionalColumns.length > 1 ? "are " : "is "} not
              required.
            </span>
          </div>
          <ul className="mb-0">
            {testQueryResults?.optionalColumns.map((warning) => {
              return (
                <div
                  className="d-flex flex-row align-items-center"
                  key={warning}
                >
                  <li>{warning}</li>
                  {warning !== ("experiment_name" || "variation_name") && (
                    <button
                      disabled={dimensions.find(
                        (dimension) => dimension === warning
                      )}
                      onClick={(e) => {
                        e.preventDefault();
                        dimensions.push(warning);
                        form.setValue("dimensions", dimensions);
                      }}
                      className="btn btn-link"
                    >
                      {dimensions.find((dimension) => dimension === warning)
                        ? "Added!"
                        : "Add as dimension"}
                    </button>
                  )}
                </div>
              );
            })}
          </ul>
        </div>
      )}
      {testQueryResults?.includesNamedColumns && (
        <div className="alert alert-warning d-flex align-items-center">
          <div className="d-flex align-items-center">
            <FaExclamationTriangle />
            <span className="pl-2">
              Your query includes a named column, but you have &quot;Use Name
              Columns&quot; disabled. Would you like to enable?
            </span>
            <button
              disabled={form.watch("hasNameCol")}
              onClick={(e) => {
                e.preventDefault();
                form.setValue("hasNameCol", true);
              }}
              className="btn btn-link"
            >
              {form.watch("hasNameCol")
                ? "Enabled"
                : "Yes, enable name columns"}
            </button>
          </div>
        </div>
      )}
      {testQueryResults?.results?.length > 0 && columns.length > 0 && (
        <>
          <h4>Example Result</h4>
          <table className="table mb-3 appbox gbtable">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
              {testQueryResults.results.map((result, i) => {
                // eslint-disable-next-line
                const values: any = Object.values(result);
                return (
                  <tr key={`${i}+${JSON.stringify(result)}`}>
                    {values.map((value, index) => {
                      return <td key={`${index}+${value}}`}>{value}</td>;
                    })}
                  </tr>
                );
              })}
            </thead>
          </table>
        </>
      )}
    </div>
  );
}
