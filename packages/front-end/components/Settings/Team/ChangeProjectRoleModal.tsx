import React, { FC, useState } from "react";
import { ProjectMemberRole } from "shared/types/organization";
import Modal from "@/components/Modal";
import SingleRoleSelector from "./SingleRoleSelector";

const ChangeProjectRoleModal: FC<{
  memberName: string;
  projectRole: ProjectMemberRole;
  close?: () => void;
  onConfirm: (data: ProjectMemberRole) => Promise<void>;
}> = ({ memberName, projectRole, close, onConfirm }) => {
  const [value, setValue] = useState(projectRole);
  return (
    <Modal
      trackingEventModalType=""
      close={close}
      header="Change Project Role"
      open={true}
      submit={async () => {
        await onConfirm(value);
      }}
    >
      <p>
        Change project role for <strong>{memberName}</strong>:
      </p>
      <SingleRoleSelector
        value={{
          role: value.role,
          environments: value.environments,
          limitAccessByEnvironment: value.limitAccessByEnvironment,
        }}
        includeAdminRole={false}
        includeProjectAdminRole={true}
        setValue={(newRoleInfo) => {
          setValue({
            ...value,
            ...newRoleInfo,
          });
        }}
      />
    </Modal>
  );
};

export default ChangeProjectRoleModal;
