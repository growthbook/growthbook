import { FC } from "react";
import { QueryInterface } from "back-end/types/query";
import { formatDistanceStrict } from "date-fns";
import {
  FaCircle,
  FaExclamationTriangle,
  FaCheck,
  FaSquare,
} from "react-icons/fa";
import { getValidDate } from "shared/dates";
import { isFactMetricId } from "shared/experiments";
import { FaBoltLightning } from "react-icons/fa6";
import { useDefinitions } from "@/services/DefinitionsContext";
import Code from "@/components/SyntaxHighlighting/Code";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import { useUser } from "@/services/UserContext";
import QueryStatsRow from "./QueryStatsRow";

const ExpandableQuery: FC<{
  query: QueryInterface;
  i: number;
  total: number;
}> = ({ query, i, total }) => {
  let title = query.displayTitle || "";
  if (query.language === "sql" && !title) {
    const comments = query.query.match(/(\n|^)\s*-- ([^\n]+)/);
    if (comments && comments[2]) {
      title = comments[2];
    }
  }

  const { getFactMetricById } = useDefinitions();

  const { hasCommercialFeature } = useUser();
  const hasOptimizedQueries = hasCommercialFeature("multi-metric-queries");

  return (
    <div className="mb-4">
      <h4 className="d-flex align-items-top">
        {query.status === "running" && (
          <FaCircle className="text-info mr-2" title="Running" />
        )}
        {query.status === "queued" && (
          <FaSquare className="text-secondary mr-2" title="Queued" />
        )}
        {query.status === "failed" && (
          <FaExclamationTriangle className="text-danger mr-2" title="Failed" />
        )}
        {query.status === "succeeded" && (
          <FaCheck className="text-success mr-2" title="Succeeded" />
        )}
        <div className="mr-1">{title}</div>
        <span style={{ fontWeight: "normal" }}>
          {title && " - "}
          Query {i + 1} of {total}
        </span>
        {query.queryType === "experimentMultiMetric" && hasOptimizedQueries && (
          <div className="ml-auto">
            <Tooltip
              body={
                <>
                  <h5>Fact Table Query Optimization</h5>
                  <p>
                    Multiple metrics in the same Fact Table are being combined
                    into a single query, which is much faster and more
                    efficient.
                  </p>
                </>
              }
            >
              <span className="badge badge-warning">
                <FaBoltLightning /> Optimized
              </span>
            </Tooltip>
          </div>
        )}
      </h4>
      <Code language={query.language} code={query.query} expandable={true} />
      {query.error && (
        <div className="alert alert-danger">
          <pre className="m-0 p-0" style={{ whiteSpace: "pre-wrap" }}>
            {query.error}
          </pre>
        </div>
      )}
      {query.status === "succeeded" && (
        <>
          {query.rawResult?.[0] ? (
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
                    {Object.keys(query.rawResult[0]).map((k) => (
                      <th key={k}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {query.rawResult.map((row, i) => {
                    return (
                      <tr key={i}>
                        <th>{i}</th>
                        {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
                        {Object.keys(query.rawResult[0]).map((k) => {
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
          ) : query.query.startsWith("SELECT") ? (
            <Callout status="warning" my="3">
              No rows returned
            </Callout>
          ) : null}
        </>
      )}
      {query.status === "succeeded" && (
        <div>
          {query.statistics ? (
            <QueryStatsRow queries={[query]} />
          ) : (
            <div className="row">
              <div className="col-auto mb-2">
                <em>Total time</em>:{" "}
                <strong>
                  {formatDistanceStrict(
                    getValidDate(query.startedAt),
                    getValidDate(query.finishedAt),
                  )}
                </strong>
              </div>
              <div className="col-auto mb-2">
                <em>Time queued</em>:{" "}
                <strong>
                  {formatDistanceStrict(
                    getValidDate(query.createdAt),
                    getValidDate(query.startedAt),
                  )}
                </strong>
              </div>
            </div>
          )}
        </div>
      )}
      {query.status === "running" && (
        <>
          <HelperText status="info" mb="2">
            Running for{" "}
            {formatDistanceStrict(getValidDate(query.startedAt), new Date())}
          </HelperText>
          {query.dependencies?.length && !query.cachedQueryUsed ? (
            <HelperText status="info" mb="2">
              Was queued for{" "}
              {formatDistanceStrict(
                getValidDate(query.createdAt),
                getValidDate(query.startedAt),
              )}
            </HelperText>
          ) : null}
        </>
      )}
      {query.status == "queued" && (
        <HelperText status="info" mb="3">
          Queued for{" "}
          {formatDistanceStrict(getValidDate(query.createdAt), new Date())}
        </HelperText>
      )}
    </div>
  );
};

export default ExpandableQuery;
