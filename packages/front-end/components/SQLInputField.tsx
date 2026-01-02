import { UserIdType } from "shared/types/datasource";
import React, { ReactElement, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { FaPlay } from "react-icons/fa";
import type { TestQueryRow } from "shared/types/integrations";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Code from "@/components/SyntaxHighlighting/Code";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import { validateSQL } from "@/services/datasources";
import { CursorData } from "./Segments/SegmentForm";

type TestQueryResults = {
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
  sql?: string;
};

type Props = {
  userEnteredQuery: string;
  datasourceId: string;
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  requiredColumns: Set<string>;
  showPreview?: boolean;
  placeholder?: string;
  helpText?: ReactElement;
  identityTypes?: UserIdType[];
  queryType:
    | "segment"
    | "dimension"
    | "metric"
    | "experiment-assignment"
    | "factTable";
  className?: string;
  setCursorData?: (data: CursorData) => void;
  showTestButton?: boolean;
  showHeadline?: boolean;
};

export default function SQLInputField({
  userEnteredQuery,
  datasourceId,
  form,
  requiredColumns,
  showPreview,
  placeholder = "",
  helpText,
  queryType,
  className,
  setCursorData,
  showTestButton = true,
  showHeadline = true,
}: Props) {
  const [testQueryResults, setTestQueryResults] =
    useState<TestQueryResults | null>(null);
  const { apiCall } = useAuth();

  // These will only be defined in Experiment Assignment Queries
  const userEnteredHasNameCol = form.watch("hasNameCol");
  const userEnteredDimensions = form.watch("dimensions");

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
      {showHeadline && (
        <label className="font-weight-bold mb-1">SQL Query</label>
      )}
      <div className="row flex-column-reverse flex-md-row">
        <div
          className={
            queryType === "experiment-assignment" ? "col-md-8" : "col-12"
          }
        >
          {showTestButton && (
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
              {queryType === "experiment-assignment" ? (
                <div className="d-flex m-1">
                  <label className="mr-2 mb-0" htmlFor="exposure-query-toggle">
                    Use Name Columns
                  </label>
                  <input
                    type="checkbox"
                    id="exposure-query-toggle"
                    className="form-check-input "
                    {...form.register("hasNameCol")}
                  />
                  <Tooltip body="Enable this if you store experiment/variation names as well as ids in your table" />
                </div>
              ) : null}
            </div>
          )}
          {showPreview ? (
            <Code language="sql" code={userEnteredQuery} />
          ) : (
            <CodeTextArea
              required
              language="sql"
              value={userEnteredQuery}
              setValue={(sql) =>
                form.setValue(
                  queryType === "experiment-assignment" ? "query" : "sql",
                  sql,
                )
              }
              placeholder={placeholder}
              helpText={helpText}
              setCursorData={setCursorData}
            />
          )}
          {testQueryResults && (
            <DisplayTestQueryResults
              duration={parseInt(testQueryResults.duration || "0")}
              results={testQueryResults.results || []}
              sql={testQueryResults.sql || ""}
              error={testQueryResults.error || ""}
              close={() => setTestQueryResults(null)}
            />
          )}
        </div>
        {queryType === "experiment-assignment" && (
          <div className="col-sm-12 col-md-4">
            <div>
              Any additional columns you select can be listed as dimensions to
              drill down into experiment results.
            </div>
            <div className="pt-3">
              <strong>Required columns</strong>
            </div>
            <ul>
              <li>
                <code>{form.watch("userIdType")}</code>
              </li>
              <li>
                <code>timestamp</code>
              </li>
              <li>
                <code>experiment_id</code>
              </li>
              <li>
                <code>variation_id</code>
              </li>
              {userEnteredHasNameCol && (
                <>
                  <li>
                    <code>experiment_name</code>
                  </li>
                  <li>
                    <code>variation_name</code>
                  </li>
                </>
              )}
              {userEnteredDimensions &&
                userEnteredDimensions.map((dimension) => {
                  return (
                    <li key={dimension}>
                      <code>{dimension}</code>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
