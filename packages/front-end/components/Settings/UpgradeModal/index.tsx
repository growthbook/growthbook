import { useEffect, useState } from "react";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import Modal from "../../Modal";
import CloudUpgradeForm from "./CloudUpgradeForm";
import SelfHostedUpgradeForm from "./SelfHostedUpgradeForm";

export interface Props {
  close: () => void;
  source: string;
  reason: string;
}

export default function UpgradeModal({ close, source, reason }: Props) {
  const [closeCta, setCloseCta] = useState("Cancel");
  const { accountPlan, permissions } = useUser();

  useEffect(() => {
    if (["pro", "pro_sso", "enterprise"].includes(accountPlan)) {
      close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountPlan]);

  if (["pro", "pro_sso", "enterprise"].includes(accountPlan)) {
    return null;
  }

  return (
    <Modal open={true} close={close} closeCta={closeCta} size="lg">
      {!permissions.check("manageBilling") ? (
        <div className="text-center mt-4 mb-5">
          To upgrade, please contact your system administrator.
        </div>
      ) : isCloud() ? (
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
