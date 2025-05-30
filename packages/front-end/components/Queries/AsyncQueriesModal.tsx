import { FC, Fragment, useMemo, useState } from "react";
import { QueryInterface } from "back-end/types/query";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import useApi from "@/hooks/useApi";
import Modal from "@/components/Modal";
import LoadingOverlay from "@/components/LoadingOverlay";
import LoadingSpinner from "@/components/LoadingSpinner";
import Code from "@/components/SyntaxHighlighting/Code";
import ExpandableQuery from "./ExpandableQuery";
import QueryStatsRow from "./QueryStatsRow";

const AsyncQueriesModal: FC<{
  queries: string[];
  close: () => void;
  error?: string;
  inline?: boolean;
}> = ({ queries, close, error: _error, inline }) => {
  const { data, error: apiError } = useApi<{ queries: QueryInterface[] }>(
    `/queries/${queries.join(",")}`
  );

  const [showStats, setShowStats] = useState(false);
  const hasStats = data?.queries?.some((q) => q.statistics !== undefined);
  const datasourceId = data?.queries?.find((q) => q.datasource)?.datasource;

  const { error, traceback } = useMemo(() => {
    if (!_error) {
      return {
        error: undefined,
        traceback: undefined,
      };
    }

    const match = _error.match(/(.*?)\n\n(Traceback.*)/s);
    const errorPart = match?.[1] || _error;
    const tracebackPart = match?.[2];

    const formattedError = errorPart
      ? errorPart
          .replace(/ {2}/g, "")
          .split("\n")
          .map((part, i) => (
            <Fragment key={i}>
              {part}
              {i < errorPart.split("\n").length - 1 && <br />}
            </Fragment>
          ))
      : undefined;

    return {
      error: formattedError,
      traceback: tracebackPart,
    };
  }, [_error]);

  const contents = (
    <>
      {error && (
        <div className="alert alert-danger">
          <div>
            <strong>Error Processing Query Results</strong>
          </div>
          {error}
          {traceback ? (
            <Code
              language="python"
              filename="Python stack trace"
              code={traceback.trim()}
              showLineNumbers={false}
              style={{ maxHeight: 500 }}
            />
          ) : null}
        </div>
      )}{" "}
      {data && data.queries.filter((q) => q === null).length > 0 && (
        <div className="alert alert-danger">
          Could not fetch information about one or more of these queries. Try
          running them again.
        </div>
      )}
      {data &&
        data.queries.filter((q) => q?.status === "queued").length > 0 &&
        datasourceId && (
          <div className="alert alert-warning">
            One or more of these queries is waiting to run. Click{" "}
            <a href={`/datasources/queries/${datasourceId}`}>here</a> to see the
            status of all your queries
          </div>
        )}
      {hasStats ? (
        <div className="mb-4">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowStats(!showStats);
            }}
          >
            {showStats ? "Hide" : "Show"} overall query stats{" "}
            {showStats ? <FaAngleDown /> : <FaAngleRight />}
          </a>
          {showStats && data && data.queries && (
            <div className="bg-light appbox px-3 pt-2 mt-2">
              <QueryStatsRow
                queries={data.queries.filter((q) => q !== null)}
                showPipelineMode={true}
              />
            </div>
          )}
        </div>
      ) : null}
      {data &&
        data.queries
          .filter((q) => q !== null)
          .map((query, i) => (
            <ExpandableQuery
              query={query}
              i={i}
              total={data.queries.length}
              key={i}
            />
          ))}
    </>
  );

  if (inline) {
    if (apiError) {
      return <div className="alert alert-danger">{apiError.message}</div>;
    }
    if (!data) {
      return <LoadingSpinner />;
    }

    return <div className="p-3">{contents}</div>;
  }

  return (
    <Modal
      trackingEventModalType="async-queries"
      close={close}
      header="Queries"
      open={true}
      size="max"
      closeCta="Close"
    >
      {!data && !apiError && <LoadingOverlay />}
      {apiError && <div className="alert alert-danger">{apiError.message}</div>}
      {contents}
    </Modal>
  );
};

export default AsyncQueriesModal;
