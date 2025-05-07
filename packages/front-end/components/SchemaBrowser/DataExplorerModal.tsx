import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import Modal from "../Modal";
import DataExplorer from "./DataExplorer";

type Props = {
  datasource: DataSourceInterfaceWithParams;
  close: () => void;
};

export default function DataExplorerModal({ datasource, close }: Props) {
  return (
    <Modal
      trackingEventModalType=""
      open={true}
      size="max"
      close={close}
      closeCta="Close"
      header="Data Explorer"
    >
      <DataExplorer datasource={datasource} />
    </Modal>
  );
}
