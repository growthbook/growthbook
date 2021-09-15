import { FC, useState } from "react";
import { QueryInterface } from "back-end/types/query";
import { formatDistanceStrict } from "date-fns";
import { FaCircle, FaExclamationTriangle, FaCheck } from "react-icons/fa";
import Code from "../Code";
import clsx from "clsx";

const ExpandableQuery: FC<{
  query: QueryInterface;
  i: number;
  total: number;
}> = ({ query, i, total }) => {
  const [queryOpen, setQueryOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);

  return (
    <div className="mb-4">
      <h4>
        {query.status === "running" && <FaCircle className="text-info mr-2" />}
        {query.status === "failed" && (
          <FaExclamationTriangle className="text-danger mr-2" />
        )}
        {query.status === "succeeded" && (
          <FaCheck className="text-success mr-2" />
        )}
        Query {i + 1} of {total}
      </h4>
      <div
        className={clsx("expandable-container text-light", {
          expanded: queryOpen,
        })}
        onClick={() => !queryOpen && setQueryOpen(true)}
      >
        <Code language={query.language} code={query.query} />
        <div
          className="fader"
          style={{
            background:
              "linear-gradient(to bottom, rgba(45,45,45,0) 0%,rgba(45,45,45,0.8) 60%)",
          }}
          onClick={(e) => {
            if (!queryOpen) return;
            setQueryOpen(false);

            const pre = (e.target as HTMLDivElement).previousElementSibling;
            if (pre) {
              pre.scrollTo({ top: 0 });
            }
          }}
        >
          click to {queryOpen ? "minimize" : "expand"}
        </div>
      </div>
      {query.status === "failed" && (
        <div className="alert alert-danger">
          <pre>{query.error}</pre>
        </div>
      )}
      {query.status === "succeeded" && (
        <div
          className={clsx("alert alert-success expandable-container mb-1", {
            expanded: resultsOpen,
          })}
          onClick={() => !resultsOpen && setResultsOpen(true)}
        >
          <pre>{JSON.stringify(query.rawResult || query.result, null, 2)}</pre>
          <div
            className="fader"
            style={{
              background:
                "linear-gradient(to bottom, rgba(212,237,218,0) 0%,rgba(212,237,218,0.8) 60%)",
            }}
            onClick={(e) => {
              if (!resultsOpen) return;
              setResultsOpen(false);

              const pre = (e.target as HTMLDivElement).previousElementSibling;
              if (pre) {
                pre.scrollTo({ top: 0 });
              }
            }}
          >
            click to {resultsOpen ? "minimize" : "expand"}
          </div>
        </div>
      )}
      {query.status === "succeeded" && (
        <small>
          <em>
            Took{" "}
            {formatDistanceStrict(
              new Date(query.startedAt),
              new Date(query.finishedAt)
            )}
          </em>
        </small>
      )}
      {query.status === "running" && (
        <div className="alert alert-info">
          <em>
            Running for{" "}
            {formatDistanceStrict(new Date(query.startedAt), new Date())}
          </em>
        </div>
      )}
    </div>
  );
};

export default ExpandableQuery;
