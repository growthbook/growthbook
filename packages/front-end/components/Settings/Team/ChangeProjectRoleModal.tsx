import React, { FC, useState } from "react";
import { ProjectMemberRole } from "shared/types/organization";
import { useDefinitions } from "@/services/DefinitionsContext";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import SingleRoleSelector from "./SingleRoleSelector";

const ChangeProjectRoleModal: FC<{
  memberName: string;
  projectRole: ProjectMemberRole;
  close: () => void;
  onConfirm: (data: ProjectMemberRole) => Promise<void>;
}> = ({ memberName, projectRole, close, onConfirm }) => {
  const [value, setValue] = useState(projectRole);
  const { getProjectById } = useDefinitions();
  return (
    <ModalStandard
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
        label={`Project: ${getProjectById(value.project)?.name}`}
        includeAdminRole={false}
        includeProjectAdminRole={true}
        setValue={(newRoleInfo) => {
          setValue({
            ...value,
            ...newRoleInfo,
          });
        }}
      />
    </ModalStandard>
  );
};

export default ChangeProjectRoleModal;
