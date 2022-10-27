import React from "react";
import { TestQueryRow } from "back-end/src/types/Integration";

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
          {`The query ran successfully in ${testQueryResults.duration} MS.`}
          {testQueryResults?.results.length === 0 &&
            " However, no rows were returned."}
        </div>
      )}
      {testQueryResults?.optionalColumns?.length > 0 && (
        <div className="alert alert-warning">
          <p>
            The column(s) listed below are not required. If you want to use
            these to drill down into experiment results, be sure to add them as
            dimension columns below.
          </p>
          {testQueryResults?.optionalColumns.map((warning) => {
            return (
              <div className="d-flex flex-row align-items-center" key={warning}>
                <li>{warning}</li>
                {warning === ("experiment_name" || "variation_name") ? (
                  <span>This is a named column</span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      dimensions.push(warning);
                      form.setValue("dimensions", dimensions);
                    }}
                    className="btn btn-link"
                  >
                    Add as Dimension
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {testQueryResults?.includesNamedColumns && (
        <div className="alert alert-warning d-flex align-items-center">
          <span>
            Your query includes a named column, but you have &quot;Use Name
            Columns&quot; disabled. Would you like to enable?
          </span>
          <button
            onClick={(e) => {
              e.preventDefault();
              form.setValue("hasNameCol", true);
            }}
            className="btn btn-link"
          >
            Yes, enable name columns
          </button>
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const values: any = Object.values(result);
                return (
                  <tr key={i}>
                    {values.map((value, i) => {
                      return <td key={i}>{value}</td>;
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
