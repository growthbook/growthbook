import React from "react";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";
import Code from "../SyntaxHighlighting/Code";

export type Props = {
  results: Record<string, unknown>[];
  duration: number;
  error?: string;
  sql: string;
};

export default function DisplayTestQueryResults({
  results,
  duration,
  error,
  sql,
}: Props) {
  const cols = Object.keys(results?.[0] || {});

  if (error) {
    return (
      <>
        <div className="alert alert-danger mt-3">
          {error}
          {sql && <Code language="sql" code={sql} expandable={true} />}
        </div>
      </>
    );
  }

  if (!results?.length) {
    return (
      <div className="alert alert-warning mt-3">
        <FaExclamationTriangle /> No rows returned, could not verify result
        {sql && <Code language="sql" code={sql} expandable={true} />}
      </div>
    );
  }

  return (
    <>
      <div className="border p-2 bg-light">
        <div className="row">
          <div className="col-auto">
            <strong>Sample {results?.length} Rows</strong>
          </div>
          <div className="col-auto ml-auto">
            <div className="text-success">
              <FaCheck />
              <span className="pl-2">Succeeded in {duration}ms</span>
            </div>
          </div>
        </div>
      </div>
      <div style={{ width: "100%", overflowX: "auto" }} className="mb-3">
        <table
          className="table table-bordered table-sm appbox w-100 mb-0"
          style={{ overflowX: "auto" }}
        >
          <thead>
            <tr>
              {cols.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((result, i) => (
              <tr key={i}>
                {Object.values(result).map((val, j) => (
                  <td key={j}>{JSON.stringify(val)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
