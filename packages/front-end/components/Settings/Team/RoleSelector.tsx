import { MemberRoleWithProjects } from "shared/types/organization";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import SingleRoleSelector from "./SingleRoleSelector";
import ProjectRolesSelector from "./ProjectRolesSelector";

export default function RoleSelector({
  value,
  setValue,
  showUpgradeModal,
}: {
  value: MemberRoleWithProjects;
  setValue: (value: MemberRoleWithProjects) => void;
  showUpgradeModal?: () => void;
}) {
  console.log("value", value);
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
