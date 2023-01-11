import { SDKConnectionInterface } from "@/../back-end/types/sdk-connection";
import { useEffect, useState } from "react";
import Modal from "../Modal";
import CheckSDKConnectionResults from "./CheckSDKConnectionResults";

type Props = {
  close: () => void;
  connection: SDKConnectionInterface;
  mutate: () => void;
  goToNextStep: () => void;
};

export default function CheckSDKConnectionModal({
  close,
  connection,
  mutate,
  goToNextStep,
}: Props) {
  const [fetchingConnectionStatus, setFetchingConnectionStatus] = useState(
    true
  );

  useEffect(() => {
    let numberOfChecks = 0;
    const refetch = setInterval(() => {
      // We'll check for an updated status for 10 seconds
      if (numberOfChecks >= 10) {
        clearInterval(refetch);
        setFetchingConnectionStatus(false);
      } else {
        numberOfChecks++;
        mutate();
      }
    }, 1000);

    if (fetchingConnectionStatus === false) {
      clearInterval(refetch);
    }
  }, [fetchingConnectionStatus, mutate]);

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
        fetchingConnectionStatus={fetchingConnectionStatus}
        setFetchingConnectionStatus={setFetchingConnectionStatus}
        mutate={mutate}
        close={close}
      />
    </Modal>
  );
}
