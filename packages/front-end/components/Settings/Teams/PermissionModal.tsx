import { MemberRoleWithProjects } from "shared/types/organization";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import { Team } from "@/services/UserContext";
import RoleSelector from "@/components/Settings/Team/RoleSelector";
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
  const form = useForm<{
    roleInfo: MemberRoleWithProjects;
  }>({
    defaultValues: {
      roleInfo: {
        role: team.role,
        limitAccessByEnvironment: team.limitAccessByEnvironment,
        environments: team.environments,
        projectRoles: team.projectRoles || [],
      },
    },
  });
  const { apiCall } = useAuth();

  return (
    <ModalStandard
      trackingEventModalType=""
      open={open}
      close={() => onClose()}
      header="Edit Team Permissions"
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/teams/${team.id}`, {
          method: "PUT",
          body: JSON.stringify({
            permissions: { ...value.roleInfo },
          }),
        });
        await onSuccess();
      })}
    >
      <RoleSelector
        value={form.watch("roleInfo")}
        setValue={(value) => form.setValue("roleInfo", value)}
      />
    </ModalStandard>
  );
};
