import React, { FC, useState } from "react";
import Modal from "../Modal";
import RoleSelector from "./RoleSelector";

export type ChangeRoleInfo = {
  uniqueKey: string;
  displayInfo: string;
  role: string;
};

const ChangeRoleModal: FC<{
  roleInfo: ChangeRoleInfo;
  close?: () => void;
  onConfirm: (role: string) => Promise<void>;
}> = ({ roleInfo, close, onConfirm }) => {
  const [role, setRole] = useState(roleInfo.role);

  return (
    <Modal
      close={close}
      header="Change Role"
      open={true}
      submit={async () => {
        await onConfirm(role);
      }}
    >
      <p>
        Change role for <strong>{roleInfo.displayInfo}</strong>:
      </p>
      <RoleSelector role={role} setRole={setRole} />
    </Modal>
  );
};

export default ChangeRoleModal;
