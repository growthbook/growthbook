import { FC, useState } from "react";
import { QueryInterface } from "back-end/types/query";
import { formatDistanceStrict } from "date-fns";
import { FaCircle, FaExclamationTriangle, FaCheck } from "react-icons/fa";
import Code from "../Code";
import clsx from "clsx";
import { getValidDate } from "../../services/dates";

const ExpandableQuery: FC<{
  query: QueryInterface;
  i: number;
  total: number;
}> = ({ query, i, total }) => {
  const [queryOpen, setQueryOpen] = useState(false);

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
        <>
          {query.rawResult?.[0] ? (
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              <table className="table table-bordered table-sm">
                <thead>
                  <tr
                    style={{ position: "sticky", top: 0 }}
                    className="bg-light"
                  >
                    <th></th>
                    {Object.keys(query.rawResult[0]).map((k) => {
                      return <th key={k}>{k}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {query.rawResult.map((row, i) => {
                    return (
                      <tr key={i}>
                        <th>{i}</th>
                        {Object.keys(query.rawResult[0]).map((k) => {
                          return (
                            <td key={k}>
                              {JSON.stringify(row[k]) ?? (
                                <em className="text-muted">null</em>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={clsx("alert alert-info mb-1")}>
              <em>No rows returned</em>
            </div>
          )}
        </>
      )}
      {query.status === "succeeded" && (
        <small>
          <em>
            Took{" "}
            {formatDistanceStrict(
              getValidDate(query.startedAt),
              getValidDate(query.finishedAt)
            )}
          </em>
        </small>
      )}
      {query.status === "running" && (
        <div className="alert alert-info">
          <em>
            Running for{" "}
            {formatDistanceStrict(getValidDate(query.startedAt), new Date())}
          </em>
        </div>
      )}
    </div>
  );
};

export default ExpandableQuery;
