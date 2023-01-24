import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import Modal from "../Modal";
import CheckSDKConnectionResults from "./CheckSDKConnectionResults";

type Props = {
  close: () => void;
  connection: SDKConnectionInterface;
  mutate: () => Promise<unknown>;
  goToNextStep: () => void;
};

export default function CheckSDKConnectionModal({
  close,
  connection,
  mutate,
  goToNextStep,
}: Props) {
  return (
    <Modal
      open={true}
      close={() => {
        close();
      }}
      closeCta="Close"
      size="lg"
      cta="Next: Add a Data Source"
      header={"Check SDK Connection"}
      submit={async () => goToNextStep()}
    >
      <CheckSDKConnectionResults
        connection={connection}
        mutate={mutate}
        close={close}
      />
    </Modal>
  );
}
