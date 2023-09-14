import { FC } from "react";
import { QueryInterface } from "back-end/types/query";
import useApi from "@/hooks/useApi";
import Modal from "../Modal";
import LoadingOverlay from "../LoadingOverlay";
import LoadingSpinner from "../LoadingSpinner";
import ExpandableQuery from "./ExpandableQuery";

const AsyncQueriesModal: FC<{
  queries: string[];
  close: () => void;
  error?: string;
  inline?: boolean;
}> = ({ queries, close, error, inline }) => {
  const { data, error: apiError } = useApi<{ queries: QueryInterface[] }>(
    `/queries/${queries.join(",")}`
  );

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
      size="lg"
      closeCta="Close"
    >
      {!data && !apiError && <LoadingOverlay />}
      {apiError && <div className="alert alert-danger">{apiError.message}</div>}
      {contents}
    </Modal>
  );
};

export default AsyncQueriesModal;
