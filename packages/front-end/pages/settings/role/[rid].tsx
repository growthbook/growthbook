import { FC } from "react";
import router from "next/router";
import { Role } from "shared/types/organization";
import RoleForm from "@/components/Teams/Roles/RoleForm";
import RoleFormWrapper from "@/components/Teams/Roles/RoleFormWrapper";
import { useUser } from "@/services/UserContext";

const CustomRolePage: FC = () => {
  const { roles } = useUser();
  const { rid, edit } = router.query;

  let role: Role = { id: "", description: "", policies: [] };

  const existingRoleIndex = roles.findIndex((orgRole) => orgRole.id === rid);
  if (existingRoleIndex > -1) {
    role = {
      ...roles[existingRoleIndex],
    };
  }

  return (
    <RoleFormWrapper
      display="Members"
      href="/settings/team#roles"
      breadcrumb={`${rid}`}
    >
      <>
        <h1 className="pb-3">{rid}</h1>
        <RoleForm role={role} action={edit ? "editing" : "viewing"} />
      </>
    </RoleFormWrapper>
  );
};

export default CustomRolePage;
