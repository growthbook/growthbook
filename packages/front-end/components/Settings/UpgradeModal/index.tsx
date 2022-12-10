import Modal from "../../Modal";
import { useUser } from "../../../services/UserContext";
import CloudUpgradeForm from "./CloudUpgradeForm";
import SelfHostedUpgradeForm from "./SelfHostedUpgradeForm";
import { useEffect, useState } from "react";
import { isCloud } from "../../../services/env";

export interface Props {
  close: () => void;
  source: string;
  reason: string;
}

export default function UpgradeModal({ close, source, reason }: Props) {
  const [closeCta, setCloseCta] = useState("Cancel");
  const { accountPlan } = useUser();

  useEffect(() => {
    if (["pro", "pro_sso", "enterprise"].includes(accountPlan)) {
      close();
    }
  }, [accountPlan, close]);

  if (["pro", "pro_sso", "enterprise"].includes(accountPlan)) {
    return null;
  }

  return (
    <Modal open={true} close={close} closeCta={closeCta} size="lg">
      {isCloud() ? (
        <CloudUpgradeForm
          accountPlan={accountPlan}
          source={source}
          reason={reason}
          setCloseCta={(s) => setCloseCta(s)}
          close={close}
        />
      ) : (
        <SelfHostedUpgradeForm
          source={source}
          setCloseCta={(s) => setCloseCta(s)}
          close={close}
        />
      )}
    </Modal>
  );
}
