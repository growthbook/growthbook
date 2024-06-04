import { FC } from "react";
import RoleForm from "@/components/Teams/Roles/RoleForm";
import RoleFormWrapper from "@/components/Teams/Roles/RoleFormWrapper";

const NewCustomRolePage: FC = () => {
  return (
    <RoleFormWrapper
      display="Members"
      href="/settings/team#roles"
      breadcrumb="Create Custom Role"
    >
      <>
        <h1 className="pb-3">Create Custom Role</h1>
        <RoleForm
          action="creating"
          role={{ id: "", description: "", policies: [] }}
        />
      </>
    </RoleFormWrapper>
  );
};

export default NewCustomRolePage;
