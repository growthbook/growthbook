import { FC } from "react";
import Modal from "../Modal";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { okaidia as style } from "react-syntax-highlighter/dist/cjs/styles/prism";
import useApi from "../../hooks/useApi";
import { QueryInterface } from "back-end/types/query";
import LoadingOverlay from "../LoadingOverlay";
import { formatDistanceStrict } from "date-fns";
import { FaCircle, FaExclamationTriangle, FaCheck } from "react-icons/fa";

const AsyncQueriesModal: FC<{
  queries: string[];
  close: () => void;
}> = ({ queries, close }) => {
  const { data, error } = useApi<{ queries: QueryInterface[] }>(
    `/queries/${queries.join(",")}`
  );

  return (
    <Modal
      close={close}
      header="Queries"
      open={true}
      size="max"
      closeCta="Close"
    >
      {!data && !error && <LoadingOverlay />}
      {error && <div className="alert alert-danger">{error.message}</div>}
      {data && data.queries.filter((q) => q === null).length > 0 && (
        <div className="alert alert-danger">
          Could not fetch information about one or more of these queries. Try
          running them again.
        </div>
      )}
      {data &&
        data.queries
          .filter((q) => q !== null)
          .map((query, i) => (
            <div key={query.id} className="mb-4">
              <h4>
                {query.status === "running" && (
                  <FaCircle className="text-info mr-2" />
                )}
                {query.status === "failed" && (
                  <FaExclamationTriangle className="text-danger mr-2" />
                )}
                {query.status === "succeeded" && (
                  <FaCheck className="text-success mr-2" />
                )}
                Query {i + 1} of {data.queries.length}
              </h4>
              <SyntaxHighlighter language={query.language} style={style}>
                {query.query}
              </SyntaxHighlighter>
              {query.status === "failed" && (
                <div className="alert alert-danger">
                  <pre>{query.error}</pre>
                </div>
              )}
              {query.status === "succeeded" && (
                <div className="alert alert-success">
                  <pre>{JSON.stringify(query.result, null, 2)}</pre>
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
                </div>
              )}
              {query.status === "running" && (
                <div className="alert alert-info">
                  <em>
                    Running for{" "}
                    {formatDistanceStrict(
                      new Date(query.startedAt),
                      new Date()
                    )}
                  </em>
                </div>
              )}
            </div>
          ))}
    </Modal>
  );
};

export default AsyncQueriesModal;
