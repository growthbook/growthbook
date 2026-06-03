import { SDKConnectionInterface } from "shared/types/sdk-connection";
import Modal from "@/components/Modal";
import ConnectionDiagram from "@/components/Features/SDKConnections/ConnectionDiagram";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

type Props = {
  close: () => void;
  connection: SDKConnectionInterface;
  goToNextStep?: () => void;
  cta?: string;
  showModalClose?: boolean;
};

export default function CheckSDKConnectionModal({
  close,
  connection,
  goToNextStep,
  cta,
  showModalClose,
}: Props) {
  const permissionsUtil = usePermissionsUtil();
  const canUpdate = permissionsUtil.canUpdateSDKConnection(connection, {});
  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={showModalClose ? close : undefined}
      closeCta="Close"
      size="lg"
      cta={cta}
      header={"Check SDK Connection"}
      submit={async () => goToNextStep?.()}
    >
      <ConnectionDiagram connection={connection} canUpdate={canUpdate} />
    </Modal>
  );
}
