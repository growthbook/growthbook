import React, { ReactElement, useMemo } from "react";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";
import Code from "../SyntaxHighlighting/Code";

export type Props = {
  results: Record<string, unknown>[];
  duration: number;
  error?: string;
  suggestions?: ReactElement[];
  requiredColumns: string[];
  sql: string;
};

export default function DisplayTestQueryResults({
  results,
  duration,
  error,
  suggestions,
  requiredColumns,
  sql,
}: Props) {
  const cols = Object.keys(results?.[0] || {});
  const missingColumns = useMemo(() => {
    if (!results?.length) return [];
    return requiredColumns.filter((col) => !(col in results[0]));
  }, [requiredColumns, results]);

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
      {missingColumns?.length > 0 && (
        <div className="alert alert-danger">
          <FaExclamationTriangle /> <strong>Error</strong>: You are missing the
          following required columns:{" "}
          {missingColumns.map((col, i) => (
            <>
              {i > 0 && ", "}
              <span key={col}>
                <code>{col}</code>
              </span>
            </>
          ))}
        </div>
      )}
      {suggestions?.length > 0 && (
        <div className="mb-2">
          <strong>Suggestions:</strong>
        </div>
      )}
      {suggestions?.map((suggestion, i) => (
        <div className="alert alert-info mb-3" key={i}>
          {suggestion}
        </div>
      ))}
    </>
  );
}
