import React from "react";
import { TestQueryRow } from "back-end/src/types/Integration";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";
import { UseFormReturn } from "react-hook-form";
import { ExposureQuery } from "back-end/types/datasource";
import Tooltip from "../Tooltip";

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
  form?: UseFormReturn<ExposureQuery>;
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
      {testQueryResults?.duration && testQueryResults?.results?.length > 0 && (
        <div className="alert alert-success">
          <FaCheck />
          <span className="pl-2">
            {`The query ran successfully in ${testQueryResults.duration} ms.`}
          </span>
        </div>
      )}
      {testQueryResults?.duration && testQueryResults?.results?.length === 0 && (
        <div className="alert alert-warning">
          <div className="d-flex align-items-center">
            <FaExclamationTriangle />
            <span className="pl-2">The query returned 0 rows.</span>
          </div>
        </div>
      )}
      {testQueryResults?.optionalColumns?.length > 0 && (
        <div className="alert alert-warning">
          <div className="d-flex align-items-center">
            <FaExclamationTriangle />
            <span className="pl-2">
              The column{testQueryResults.optionalColumns.length > 1 && "s "}{" "}
              listed below{" "}
              {testQueryResults.optionalColumns.length > 1 ? "are " : "is "}
              not required.
            </span>
            <Tooltip
              className="pl-2"
              body="Any additional columns you select can be listed as dimensions to drill down into experiment results, otherwise, you can remove them to improve performance."
            />
          </div>
          <ul className="mb-0">
            {testQueryResults?.optionalColumns.map((column) => {
              return (
                <li key={column}>
                  <div className="d-flex align-items-center">
                    {column}
                    <button
                      disabled={dimensions.includes(column)}
                      onClick={(e) => {
                        e.preventDefault();
                        form.setValue("dimensions", [...dimensions, column]);
                      }}
                      className="btn btn-link"
                    >
                      {dimensions.find((dimension) => dimension === column)
                        ? "Added!"
                        : "Add as dimension"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {testQueryResults?.results?.length > 0 && columns.length > 0 && (
        <>
          <h4>Sample Returned Row</h4>
          <table className="table mb-3 appbox gbtable">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {testQueryResults.results.map((result, i) => {
                const values = Object.values(result);
                return (
                  <tr key={i}>
                    {values.map((value: string, index) => {
                      return <td key={`${index}+${value}}`}>{value}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
