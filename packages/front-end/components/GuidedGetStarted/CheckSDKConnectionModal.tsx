import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import Modal from "@/components/Modal";
import CheckSDKConnectionResults from "./CheckSDKConnectionResults";

type Props = {
  close: () => void;
  connection: SDKConnectionInterface;
  mutate: () => Promise<unknown>;
  goToNextStep?: () => void;
  cta?: string;
  showModalClose?: boolean;
};

export default function CheckSDKConnectionModal({
  close,
  connection,
  mutate,
  goToNextStep,
  cta,
  showModalClose,
}: Props) {
  return (
    <Modal
      open={true}
      close={showModalClose ? close : undefined}
      closeCta="Close"
      size="lg"
      cta={cta}
      header={"Check SDK Connection"}
      submit={async () => goToNextStep?.()}
    >
      <CheckSDKConnectionResults
        connection={connection}
        mutate={mutate}
        close={close}
      />
    </Modal>
  );
}
