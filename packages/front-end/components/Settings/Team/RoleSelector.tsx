import { MemberRoleWithProjects } from "back-end/types/organization";
import SingleRoleSelector from "./SingleRoleSelector";
import ProjectRolesSelector from "./ProjectRolesSelector";
import UniversalUpgradeMessage from "../UniversalUpgradeMessage";

export default function RoleSelector({
  value,
  setValue,
  showUpgradeModal,
}: {
  value: MemberRoleWithProjects;
  setValue: (value: MemberRoleWithProjects) => void;
  showUpgradeModal: () => void;
}) {
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
      />
      <ProjectRolesSelector
        projectRoles={value.projectRoles || []}
        setProjectRoles={(projectRoles) => {
          setValue({
            ...value,
            projectRoles,
          });
        }}
      />
      <UniversalUpgradeMessage
        showUpgradeModal={showUpgradeModal}
        commercialFeature="advanced-permissions"
        upgradeMessage="enable per-environment and per-project permissions"
      />
    </div>
  );
}
