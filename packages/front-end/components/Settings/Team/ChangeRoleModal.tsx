import { FC, useState } from "react";
import { MemberRoleWithProjects } from "shared/types/organization";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RoleSelector from "./RoleSelector";

const ChangeRoleModal: FC<{
  displayInfo: string;
  roleInfo: MemberRoleWithProjects;
  close: () => void;
  onConfirm: (data: MemberRoleWithProjects) => Promise<void>;
}> = ({ roleInfo, displayInfo, close, onConfirm }) => {
  const [value, setValue] = useState(roleInfo);

  const [upgradeModal, setUpgradeModal] = useState(false);

  if (upgradeModal) {
    return (
      <UpgradeModal
        close={() => setUpgradeModal(false)}
        source="advanced-permissions"
        commercialFeature="advanced-permissions"
      />
    );
  }

  return (
    <ModalStandard
      trackingEventModalType=""
      close={close}
      header="Change Role"
      subheader={
        <>
          Change role for <strong>{displayInfo}</strong>
        </>
      }
      open={true}
      submit={async () => {
        await onConfirm(value);
      }}
    >
      <RoleSelector
        value={value}
        setValue={setValue}
        showUpgradeModal={() => setUpgradeModal(true)}
      />
    </ModalStandard>
  );
};

export default ChangeRoleModal;
