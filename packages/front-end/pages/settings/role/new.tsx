import { FC } from "react";
import RoleForm from "@/components/Teams/Roles/RoleForm";
import RoleFormWrapper from "@/components/Teams/Roles/RoleFormWrapper";
import Heading from "@/ui/Heading";

const NewCustomRolePage: FC = () => {
  return (
    <RoleFormWrapper
      display="Members"
      href="/settings/team#roles"
      breadcrumb="Create Custom Role"
    >
      <>
        <Heading as="h1" size="large" mb="3">
          Create Custom Role
        </Heading>
        <RoleForm
          action="creating"
          role={{ id: "", description: "", policies: [] }}
        />
      </>
    </RoleFormWrapper>
  );
};

export default NewCustomRolePage;
