import { FC } from "react";
import router from "next/router";
import { Role } from "shared/types/organization";
import RoleForm from "@/components/Teams/Roles/RoleForm";
import RoleFormWrapper from "@/components/Teams/Roles/RoleFormWrapper";
import { useUser } from "@/services/UserContext";
import Heading from "@/ui/Heading";

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
        <Heading as="h1" size="lg" mb="3">
          {rid}
        </Heading>
        <RoleForm
          // Keyed by role: the form seeds its state from `role` once, so navigating
          // between two custom roles would otherwise show the previous one's edits.
          key={role.id || String(rid)}
          role={role}
          action={edit ? "editing" : "viewing"}
        />
      </>
    </RoleFormWrapper>
  );
};

export default CustomRolePage;
