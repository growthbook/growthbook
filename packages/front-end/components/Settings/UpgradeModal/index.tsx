import Modal from "../../Modal";
import { useUser } from "../../../services/UserContext";
import CloudUpgradeForm from "./CloudUpgradeForm";
import SelfHostedUpgradeForm from "./SelfHostedUpgradeForm";
import { useState } from "react";

export const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});

export interface Props {
  close: () => void;
  source: string;
  reason: string;
}

export default function UpgradeModal({ close, source, reason }: Props) {
  const [closeCta, setCloseCta] = useState("Cancel");
  const { accountPlan } = useUser();
  if (["pro", "pro_sso", "enterprise"].includes(accountPlan)) {
    close();
  }

  return (
    <Modal open={true} close={close} closeCta={closeCta} size="lg">
      {accountPlan === "starter" ? (
        <CloudUpgradeForm
          accountPlan={accountPlan}
          source={source}
          reason={reason}
          setCloseCta={(s) => setCloseCta(s)}
          close={close}
        />
      ) : accountPlan === "oss" ? (
        <SelfHostedUpgradeForm
          source={source}
          setCloseCta={(s) => setCloseCta(s)}
          close={close}
        />
      ) : null}
    </Modal>
  );
}
