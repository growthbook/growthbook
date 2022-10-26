import React, { FC, useState } from "react";
import Modal from "../Modal";
import RoleSelector from "./RoleSelector";
import { MemberRoleWithProjects } from "back-end/types/organization";
import { isCloud } from "../../services/env";
import UpgradeModal from "./UpgradeModal";

const ChangeRoleModal: FC<{
  displayInfo: string;
  roleInfo: MemberRoleWithProjects;
  close?: () => void;
  onConfirm: (data: MemberRoleWithProjects) => Promise<void>;
}> = ({ roleInfo, displayInfo, close, onConfirm }) => {
  const [value, setValue] = useState(roleInfo);

  const [upgradeModal, setUpgradeModal] = useState(false);

  if (upgradeModal && isCloud()) {
    return (
      <UpgradeModal
        close={() => setUpgradeModal(false)}
        reason="To enable advanced permissioning rules,"
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
