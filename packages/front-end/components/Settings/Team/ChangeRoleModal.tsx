import React, { FC, useState } from "react";
import { MemberRoleWithProjects } from "back-end/types/organization";
import Modal from "@/components/Modal";
import UpgradeModal from "@/components/Settings/UpgradeModal";
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
      trackingEventModalType=""
      close={close}
      header="修改角色"
      open={true}
      submit={async () => {
        await onConfirm(value);
      }}
    >
      <p>
        修改 <strong>{displayInfo}</strong> 角色:
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
