import { SqlExplorerBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { useState } from "react";
import useApi from "@/hooks/useApi";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";
import Button from "@/components/Radix/Button";
import { BlockProps } from ".";

export default function SqlExplorerBlock({
  savedQueryId,
  setBlock,
}: BlockProps<SqlExplorerBlockInterface>) {
  const { data, mutate: mutateQuery } = useApi<{
    status: number;
    savedQuery?: SavedQuery;
  }>(`/saved-queries/${savedQueryId}`, { shouldRun: () => !!savedQueryId });

  const [showModal, setShowModal] = useState(false);

  return (
    <div>
      {showModal && (
        <SqlExplorerModal
          close={(id?: string) => {
            setShowModal(false);
            setBlock({ type: "sql-explorer", savedQueryId: id });
          }}
          mutate={mutateQuery}
          initial={data?.savedQuery}
        />
      )}
      {!savedQueryId && (
        // Empty state
        <Button onClick={() => setShowModal(true)}>Add Sql Query</Button>
      )}
      {savedQueryId && <>{data?.savedQuery ? <></> : <></>}</>}
    </div>
  );
}
