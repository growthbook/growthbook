import { useState } from "react";
import { MemberRoleWithProjects } from "shared/types/organization";
import { useAuth } from "@/services/auth";
import { Team } from "@/services/UserContext";
import RoleRulesTable from "@/components/Settings/Team/RoleRulesTable";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export const PermissionsModal = ({
  team,
  open,
  onClose,
  onSuccess,
}: {
  team: Team;
  open: boolean;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}) => {
  const [value, setValue] = useState<MemberRoleWithProjects>({
    role: team.role,
    limitAccessByEnvironment: team.limitAccessByEnvironment,
    environments: team.environments,
    additionalRoles: team.additionalRoles || [],
    projectRoles: team.projectRoles || [],
  });
  const { apiCall } = useAuth();

  return (
    <ModalStandard
      trackingEventModalType=""
      open={open}
      close={() => onClose()}
      header="Edit Team Permissions"
      subheader={
        <>
          Members of <strong>{team.name}</strong> get these on top of their own
          roles.
        </>
      }
      size="xl"
      submit={async () => {
        await apiCall(`/teams/${team.id}`, {
          method: "PUT",
          body: JSON.stringify({ permissions: value }),
        });
        await onSuccess();
      }}
    >
      <RoleRulesTable value={value} setValue={setValue} />
    </ModalStandard>
  );
};
