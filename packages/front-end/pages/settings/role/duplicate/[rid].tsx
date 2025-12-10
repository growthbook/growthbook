import { FC } from "react";
import router from "next/router";
import { Role } from "shared/types/organization";
import RoleForm from "@/components/Teams/Roles/RoleForm";
import RoleFormWrapper from "@/components/Teams/Roles/RoleFormWrapper";
import { useUser } from "@/services/UserContext";

const CustomRolePage: FC = () => {
  const { roles } = useUser();
  const { rid } = router.query;

  let role: Role = { id: "", description: "", policies: [] };

  const existingRoleIndex = roles.findIndex((orgRole) => orgRole.id === rid);
  if (existingRoleIndex > -1) {
    role = {
      ...roles[existingRoleIndex],
      id: `copyOf_${roles[existingRoleIndex].id}`,
    };
  }

  return (
    <RoleFormWrapper
      display="Members"
      href="/settings/team#roles"
      breadcrumb={"Duplicate Role"}
    >
      <>
        <h1 className="pb-3">Duplicate {rid}</h1>
        <RoleForm role={role} action="creating" />
      </>
    </RoleFormWrapper>
  );
};

export default CustomRolePage;
