import { FC, useState } from "react";
import { MemberRoleWithProjects } from "shared/types/organization";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RoleRulesTable from "./RoleRulesTable";
import { TeamRuleSource } from "./roleRules";

const ChangeRoleModal: FC<{
  displayInfo: string;
  roleInfo: MemberRoleWithProjects;
  teams?: TeamRuleSource[];
  close: () => void;
  onConfirm: (data: MemberRoleWithProjects) => Promise<void>;
}> = ({ roleInfo, displayInfo, teams, close, onConfirm }) => {
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
      size="xl"
      submit={async () => {
        await onConfirm(value);
      }}
    >
      <RoleRulesTable value={value} setValue={setValue} teams={teams} />
    </ModalStandard>
  );
};

export default ChangeRoleModal;
