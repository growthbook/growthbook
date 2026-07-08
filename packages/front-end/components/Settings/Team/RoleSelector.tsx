import { MemberRoleWithProjects } from "shared/types/organization";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import { useUser } from "@/services/UserContext";
import SingleRoleSelector from "./SingleRoleSelector";
import ProjectRolesSelector from "./ProjectRolesSelector";

export default function RoleSelector({
  value,
  setValue,
  showUpgradeModal,
  currentRole,
}: {
  value: MemberRoleWithProjects;
  setValue: (value: MemberRoleWithProjects) => void;
  showUpgradeModal?: () => void;
  currentRole?: string;
}) {
  const { hasCommercialFeature } = useUser();

  return (
    <div>
      <SingleRoleSelector
        value={{
          role: value.role,
          environments: value.environments,
          limitAccessByEnvironment: value.limitAccessByEnvironment,
        }}
        setValue={(newRoleInfo) => {
          setValue({
            ...value,
            ...newRoleInfo,
          });
        }}
        label="Global Role"
        includeAdminRole={true}
        includeProjectAdminRole={true}
        currentRole={currentRole}
      />

      {hasCommercialFeature("advanced-permissions") ? (
        <ProjectRolesSelector
          projectRoles={value.projectRoles || []}
          setProjectRoles={(projectRoles) => {
            setValue({
              ...value,
              projectRoles,
            });
          }}
        />
      ) : null}
      {!!showUpgradeModal && (
        <UpgradeMessage
          className="mt-3"
          showUpgradeModal={showUpgradeModal}
          commercialFeature="advanced-permissions"
          upgradeMessage="enable per-environment and per-project permissions"
        />
      )}
    </div>
  );
}
