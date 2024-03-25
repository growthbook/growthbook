import { useEffect, useState } from "react";
import { useUser } from "@front-end/services/UserContext";
import { isCloud } from "@front-end/services/env";
import Modal from "@front-end/components/Modal";
import CloudUpgradeForm from "./CloudUpgradeForm";
import SelfHostedUpgradeForm from "./SelfHostedUpgradeForm";

export interface Props {
  close: () => void;
  source: string;
  reason: string;
}

export default function UpgradeModal({ close, source }: Props) {
  const [closeCta, setCloseCta] = useState("Cancel");
  const { accountPlan, permissions } = useUser();

  useEffect(() => {
    // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
    if (["pro", "pro_sso", "enterprise"].includes(accountPlan)) {
      close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountPlan]);

  // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
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
          // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'AccountPlan | undefined' is not assignable t... Remove this comment to see the full error message
          accountPlan={accountPlan}
          source={source}
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
