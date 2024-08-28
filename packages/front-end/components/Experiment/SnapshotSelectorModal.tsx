import { SnapshotSelectorSummary } from "back-end/types/experiment-snapshot";
import { datetime } from "shared/dates";
import { useRouter } from "next/router";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";
import LoadingSpinner from "@/components/LoadingSpinner";
import useApi from "@/hooks/useApi";
import { useSearch } from "@/services/search";
import Modal from "@/components/Modal";
import Badge from "@/components/Badge";

export interface Props {
  experimentId: string;
  phase: number;
  currentSnapshotId: string | null;
  setDesiredSnapshot: (snapshotId: string | null) => void;
  close: () => void;
}

export default function SnapshotSelectorModal({
  experimentId,
  phase,
  currentSnapshotId,
  setDesiredSnapshot,
  close,
}: Props) {
  const router = useRouter();

  const { data } = useApi<{
    snapshots: SnapshotSelectorSummary[];
  }>(`/experiment/${experimentId}/${phase}/snapshots`);

  const snapshots = data?.snapshots;

  const { items, SortableTH } = useSearch({
    items: snapshots ?? [],
    localStorageKey: "snapshotSelectorList",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: [],
  });

  return (
    <Modal
      open={true}
      header="Snapshot History"
      close={close}
      size={"lg"}
      includeCloseCta={false}
    >
      {snapshots === undefined ? (
        <LoadingSpinner />
      ) : snapshots.length ? (
        <div>
          <table className="table bg-white border">
            <thead className="bg-light">
              <tr>
                <SortableTH field="id">Snapshot</SortableTH>
                <SortableTH field="dateCreated">Date Created</SortableTH>
                <SortableTH field="dimension">Dimension</SortableTH>
                <SortableTH field="status">Status</SortableTH>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => {
                const isLatest = s.id === snapshots[0].id;
                return (
                  <tr key={s.id}>
                    <td>
                      {s.id}
                      {isLatest ? (
                        <Badge
                          className="ml-1 badge-primary"
                          content="latest"
                        />
                      ) : null}
                    </td>
                    <td>{datetime(s.dateCreated)}</td>
                    <td>{s.dimension ? s.dimension : "-"}</td>
                    <td>
                      {s.status === "success" ? (
                        <FaCheck className="check text-success" />
                      ) : (
                        <FaExclamationTriangle className="text-danger" />
                      )}
                    </td>
                    <td>
                      {s.id === currentSnapshotId ? (
                        "Loaded"
                      ) : (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            if (isLatest) {
                              setDesiredSnapshot(null);
                              router.replace(`/experiment/${experimentId}`);
                            } else {
                              setDesiredSnapshot(s.id);
                              router.replace(
                                `/experiment/${experimentId}?snapshot=${s.id}`
                              );
                            }
                            close();
                          }}
                        >
                          Load
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        "No snapshots available"
      )}
    </Modal>
  );
}
