import React from "react";
import { TestQueryRow } from "back-end/src/types/Integration";

export type TestQueryResults = {
  status: number;
  optionalColumns?: string[];
  duration?: string;
  noRowsReturned: boolean;
  error?: string;
  results?: TestQueryRow[];
};

type Props = {
  testQueryResults: TestQueryResults | null;
};

export default function DisplayTestQueryResults({ testQueryResults }: Props) {
  return (
    <>
      {testQueryResults?.duration && (
        <div className="alert alert-success">
          {`The query ran successfully in ${testQueryResults.duration} MS.`}
          {testQueryResults?.noRowsReturned &&
            " However, no rows were returned."}
        </div>
      )}
      {testQueryResults?.optionalColumns?.length > 0 && (
        <div className="alert alert-warning">
          <p>
            The column(s) listed below are not required. If you want to use
            these to drill down into experiment results, be sure to add them as
            dimension columns below. Otherwise, they can be removed to improve
            performance.
          </p>
          {testQueryResults?.optionalColumns.map((warning) => {
            return <li key={warning}>{warning}</li>;
          })}
        </div>
      )}
    </>
  );
}
