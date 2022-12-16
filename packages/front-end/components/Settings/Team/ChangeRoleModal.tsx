import React, { FC, useState } from "react";
import { MemberRoleWithProjects } from "back-end/types/organization";
import Modal from "../../Modal";
import UpgradeModal from "../UpgradeModal";
import RoleSelector from "./RoleSelector";

const ChangeRoleModal: FC<{
  displayInfo: string;
  roleInfo: MemberRoleWithProjects;
  close?: () => void;
  onConfirm: (data: MemberRoleWithProjects) => Promise<void>;
}> = ({ roleInfo, displayInfo, close, onConfirm }) => {
  const [value, setValue] = useState(roleInfo);

  const [upgradeModal, setUpgradeModal] = useState(false);

  if (upgradeModal) {
    return (
      <UpgradeModal
        close={() => setUpgradeModal(false)}
        reason="To enable advanced permissioning,"
        source="advanced-permissions"
      />
    );
  }

  return (
    <Modal
      close={close}
      header="Change Role"
      open={true}
      submit={async () => {
        await onConfirm(value);
      }}
    >
      <p>
        Change role for <strong>{displayInfo}</strong>:
      </p>
      <RoleSelector
        value={value}
        setValue={setValue}
        showUpgradeModal={() => setUpgradeModal(true)}
      />
    </Modal>
  );
};

export default ChangeRoleModal;
