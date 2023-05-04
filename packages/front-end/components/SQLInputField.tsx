import React, { useState } from "react";
import { FaPlay } from "react-icons/fa";
import type { TestQueryRow } from "back-end/src/types/Integration";
import DisplayTestQueryResults from "../components/Settings/DisplayTestQueryResults";
import Code from "../components/SyntaxHighlighting/Code";
import { useAuth } from "../services/auth";
import { validateSQL } from "../services/datasources";

type TestQueryResults = {
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
  sql?: string;
};

type Props = {
  userEnteredQuery: string;
  datasourceId: string;
  requiredColumns: Set<string>;
  className?: string;
};

export default function SQLInputField({
  userEnteredQuery,
  datasourceId,
  requiredColumns,
  className,
}: Props) {
  const [
    testQueryResults,
    setTestQueryResults,
  ] = useState<TestQueryResults | null>(null);
  const { apiCall } = useAuth();

  const handleTestQuery = async () => {
    setTestQueryResults(null);
    try {
      validateSQL(userEnteredQuery, [...requiredColumns]);

      const res: TestQueryResults = await apiCall("/query/test", {
        method: "POST",
        body: JSON.stringify({
          query: userEnteredQuery,
          datasourceId: datasourceId,
        }),
      });

      setTestQueryResults(res);
    } catch (e) {
      setTestQueryResults({ error: e.message });
    }
  };

  return (
    <div className={className}>
      <label className="font-weight-bold mb-1">SQL Query</label>
      <div className="row flex-column-reverse flex-md-row">
        <div className={"col-12"}>
          <div className="d-flex justify-content-between align-items-center p-1 border rounded">
            <button
              className="btn btn-sm btn-primary m-1"
              onClick={(e) => {
                e.preventDefault();
                handleTestQuery();
              }}
            >
              <span className="pr-2">
                <FaPlay />
              </span>
              Test Query
            </button>
          </div>
          <Code language="sql" code={userEnteredQuery} />
          {testQueryResults && (
            <DisplayTestQueryResults
              duration={parseInt(testQueryResults.duration || "0")}
              requiredColumns={[...requiredColumns]}
              results={testQueryResults.results}
              error={testQueryResults.error}
              sql={testQueryResults.sql}
            />
          )}
        </div>
      </div>
    </div>
  );
}
