import React from "react";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";
import clsx from "clsx";
import Code from "@/components/SyntaxHighlighting/Code";
import Tabs from "@/components/Radix/Tabs";

export type Props = {
  results: Record<string, unknown>[];
  duration: number;
  sql: string;
  error: string;
  close: () => void;
  expandable?: boolean;
};

export default function DisplayTestQueryResults({
  results,
  duration,
  sql,
  error,
  close,
  expandable,
}: Props) {
  const cols = Object.keys(results?.[0] || {});
  const forceShowSql = error || !results.length;

  // Match the line number from the error message
  const errorLineMatch = error.match(/line\s+(\d+)|\[(\d+):\d+\]$/i);
  const errorLine = errorLineMatch
    ? Number(errorLineMatch[1] || errorLineMatch[2])
    : undefined;

  const tabs = [
    {
      slug: "results",
      label: "Results",
      content: (
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
          <div style={{ width: "100%", overflow: "auto" }} className="mb-3">
            <table
              className="table table-bordered table-sm appbox w-100 mb-0"
              style={{ overflow: "auto" }}
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
      ),
    },
    {
      slug: "sql",
      label: "Rendered SQL",
      content: (
        <div style={{ overflowY: "auto", height: "100%" }}>
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
          <Code
            code={sql}
            language="sql"
            errorLine={errorLine}
            expandable={expandable}
          />
        </div>
      ),
    },
  ];

  // Filter out the results tab if we're forcing SQL view
  const visibleTabs = forceShowSql
    ? tabs.filter((t) => t.slug === "sql")
    : tabs;

  return (
    <div className="pt-1 d-flex flex-column h-100">
      <div className="px-3 position-relative">
        <button
          type="button"
          className="close position-absolute"
          style={{ right: "1rem", top: "0" }}
          onClick={(e) => {
            e.preventDefault();
            close();
          }}
          aria-label="Close"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className={clsx("px-3 pt-3 flex-grow-1 overflow-auto")}>
        <Tabs
          tabs={visibleTabs}
          defaultTabSlug={forceShowSql ? "sql" : "results"}
        />
      </div>
    </div>
  );
}
