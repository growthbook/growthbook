import { FC, useState } from "react";
import { QueryInterface } from "back-end/types/query";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import useApi from "@/hooks/useApi";
import Modal from "@/components/Modal";
import LoadingOverlay from "@/components/LoadingOverlay";
import LoadingSpinner from "@/components/LoadingSpinner";
import ExpandableQuery from "./ExpandableQuery";
import QueryStatsRow from "./QueryStatsRow";

const AsyncQueriesModal: FC<{
  queries: string[];
  close: () => void;
  error?: string;
  inline?: boolean;
}> = ({ queries, close, error, inline }) => {
  const { data, error: apiError } = useApi<{ queries: QueryInterface[] }>(
    `/queries/${queries.join(",")}`
  );

  const [showStats, setShowStats] = useState(false);
  const hasStats = data?.queries?.some((q) => q.statistics !== undefined);
  const datasourceId = data?.queries?.find((q) => q.datasource)?.datasource;

  const contents = (
    <>
      {error && (
        <div className="alert alert-danger">
          <div>
            <strong>Error Processing Query Results</strong>
          </div>
          {error}
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
            <div className="bg-light appbox px-3 pt-2">
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
