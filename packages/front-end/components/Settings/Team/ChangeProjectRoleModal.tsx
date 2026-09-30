import React, { FC, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { ProjectMemberRole } from "shared/types/organization";
import { roleSupportsEnvLimit } from "shared/permissions";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import ProjectRuleFields from "./ProjectRuleFields";

const ChangeProjectRoleModal: FC<{
  memberName: string;
  projectRole: ProjectMemberRole;
  close: () => void;
  onConfirm: (data: ProjectMemberRole) => Promise<void>;
}> = ({ memberName, projectRole, close, onConfirm }) => {
  const [value, setValue] = useState(projectRole);
  const { getProjectById } = useDefinitions();
  const { organization } = useUser();

  return (
    <ModalStandard
      trackingEventModalType=""
      close={close}
      header="Edit Project Role"
      subheader={
        <>
          Edit the Project role for <strong>{memberName}</strong>.
        </>
      }
      open={true}
      size="lg"
      submit={async () => {
        // Normalize even when the role wasn't changed this session — a stored
        // rule can already carry an env restriction its role doesn't support.
        await onConfirm(
          roleSupportsEnvLimit(value.role, organization)
            ? value
            : { ...value, limitAccessByEnvironment: false, environments: [] },
        );
      }}
    >
      <Flex align="center" gap="2" mb="2" minHeight="32px">
        <Text weight="medium">
          {getProjectById(value.project)?.name ?? value.project}
        </Text>
        <Text size="sm" color="text-low">
          replaces the All Projects rules inside it
        </Text>
      </Flex>
      <ProjectRuleFields rule={value} setRule={setValue} />
    </ModalStandard>
  );
};

export default ChangeProjectRoleModal;
