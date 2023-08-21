import React, { useState } from "react";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";
import clsx from "clsx";
import Code from "../SyntaxHighlighting/Code";

export type Props = {
  results: Record<string, unknown>[];
  duration: number;
  sql: string;
  error: string;
  close: () => void;
};

export default function DisplayTestQueryResults({
  results,
  duration,
  sql,
  error,
  close,
}: Props) {
  const cols = Object.keys(results?.[0] || {});

  const forceShowSql = error || !results.length;

  // Match the line number from the error message that
  // either has "line <line number>" in it,
  // or ends with "[<line number>:<col number>]"
  const errorLineMatch = error.match(/line\s+(\d+)|\[(\d+):\d+\]$/i);
  const errorLine = errorLineMatch
    ? Number(errorLineMatch[1] || errorLineMatch[2])
    : undefined;

  const [showSql, setShowSql] = useState(forceShowSql);

  return (
    <>
      <div className="card">
        <div className="card-header d-flex justify-content-between">
          <ul className="nav nav-tabs card-header-tabs p-0 m-0">
            <li className="nav-item">
              <a
                className={clsx("nav-link", {
                  active: !showSql,
                  disabled: forceShowSql,
                })}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setShowSql(false);
                }}
              >
                Results
              </a>
            </li>
            <li className="nav-item">
              <a
                className={clsx("nav-link", {
                  active: showSql || forceShowSql,
                })}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setShowSql(true);
                }}
              >
                Rendered SQL
              </a>
            </li>
          </ul>
          <button
            type="button"
            className="close"
            onClick={(e) => {
              e.preventDefault();
              close();
            }}
            aria-label="Close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>

      {showSql ? (
        <div className="card-body">
          <div>
            {error ? (
              <div className="alert alert-danger mr-auto">{error}</div>
            ) : (
              !results.length && (
                <div className="alert alert-warning mr-auto">
                  <FaExclamationTriangle /> No rows returned, could not verify
                  result
                </div>
              )
            )}
            <Code code={sql} language="sql" errorLine={errorLine} />
          </div>
        </div>
      ) : (
        <div className="card-body">
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
        </div>
      )}
    </>
  );
}
