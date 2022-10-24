import React, { FC, useState } from "react";
import Modal from "../Modal";
import RoleSelector from "./RoleSelector";
import { MemberRoleInfo } from "back-end/types/organization";
import { useForm } from "react-hook-form";
import { isCloud } from "../../services/env";
import UpgradeModal from "./UpgradeModal";

const ChangeRoleModal: FC<{
  displayInfo: string;
  roleInfo: MemberRoleInfo;
  close?: () => void;
  onConfirm: (data: MemberRoleInfo) => Promise<void>;
}> = ({ roleInfo, displayInfo, close, onConfirm }) => {
  const form = useForm<MemberRoleInfo>({
    defaultValues: roleInfo,
  });

  const [upgradeModal, setUpgradeModal] = useState(false);

  const role = form.watch("role");

  if (upgradeModal && isCloud()) {
    return (
      <UpgradeModal
        close={() => setUpgradeModal(false)}
        reason="Restrict access by environment."
        source="env-permissions"
      />
    );
  }

  return (
    <Modal
      close={close}
      header="Change Role"
      open={true}
      submit={form.handleSubmit(async (value) => {
        await onConfirm(value);
      })}
    >
      <p>
        Change role for <strong>{displayInfo}</strong>:
      </p>
      <RoleSelector
        role={role}
        setRole={(role) => form.setValue("role", role)}
        limitAccessByEnvironment={form.watch("limitAccessByEnvironment")}
        setLimitAccessByEnvironment={(envAccess) =>
          form.setValue("limitAccessByEnvironment", envAccess)
        }
        environments={form.watch("environments")}
        setEnvironments={(envs) => form.setValue("environments", envs)}
        showUpgradeModal={() => setUpgradeModal(true)}
      />
    </Modal>
  );
};

export default ChangeRoleModal;
