import { FC } from "react";
import { FaExclamationTriangle, FaCheck } from "react-icons/fa";
import { isFactMetricId } from "shared/experiments";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { formatDuration } from "date-fns";
import { useDefinitions } from "@/services/DefinitionsContext";
import Code from "@/components/SyntaxHighlighting/Code";
import Callout from "@/ui/Callout";

const ExpandableSavedQuery: FC<{
  savedQuery: SavedQuery;
  i: number;
  total: number;
}> = ({ savedQuery, i, total }) => {
  let title = "";
  if (savedQuery.sql) {
    const comments = savedQuery.sql.match(/(\n|^)\s*-- ([^\n]+)/);
    if (comments && comments[2]) {
      title = comments[2];
    }
  }

  const { getFactMetricById } = useDefinitions();

  return (
    <div className="mb-4">
      <h4 className="d-flex align-items-top">
        {savedQuery.results.error ? (
          <FaExclamationTriangle className="text-danger mr-2" title="Failed" />
        ) : (
          <FaCheck className="text-success mr-2" title="Succeeded" />
        )}
        <div className="mr-1">{title}</div>
        <span style={{ fontWeight: "normal" }}>
          {title && " - "}
          Query {i + 1} of {total}
        </span>
      </h4>
      <Code language={"sql"} code={savedQuery.sql} expandable={true} />
      {savedQuery.results.error && (
        <div className="alert alert-danger">
          <pre className="m-0 p-0" style={{ whiteSpace: "pre-wrap" }}>
            {savedQuery.results.error}
          </pre>
        </div>
      )}
      {savedQuery.results.results[0] ? (
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          <table className="table table-bordered table-sm query-table">
            <thead>
              <tr
                style={{
                  position: "sticky",
                  top: -1,
                }}
              >
                <th></th>
                {Object.keys(savedQuery.results.results[0]).map((k) => (
                  <th key={k}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {savedQuery.results.results.map((row, i) => {
                return (
                  <tr key={i}>
                    <th>{i}</th>
                    {Object.keys(savedQuery.results.results[0]).map((k) => {
                      const val = row[k];
                      if (typeof val === "string" && isFactMetricId(val)) {
                        const factMetric = getFactMetricById(val);
                        if (factMetric) {
                          return (
                            <td key={k}>
                              <span
                                className="badge badge-secondary"
                                title={val}
                              >
                                {factMetric?.name || val}
                              </span>
                            </td>
                          );
                        }
                      }

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
        <Callout status="warning" my="3">
          No rows returned
        </Callout>
      )}
      {savedQuery.results.duration && (
        <div>
          <div className="row">
            <div className="col-auto mb-2">
              <em>Total time</em>:{" "}
              <strong>
                {formatDuration({
                  seconds: savedQuery.results.duration / 1000,
                })}
              </strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpandableSavedQuery;
