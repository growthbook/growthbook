import { FC } from "react";
import router from "next/router";
import RoleForm from "@/components/Teams/Roles/RoleForm";
import RoleFormWrapper from "@/components/Teams/Roles/RoleFormWrapper";

const CustomRolePage: FC = () => {
  const { rid } = router.query;

  if (!rid || Array.isArray(rid)) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">Unable to locate the role.</div>
      </div>
    );
  }

  return (
    <RoleFormWrapper
      display="Members"
      href="/settings/team#roles"
      breadcrumb={`${rid}`}
    >
      <>
        <h1 className="pb-3">Duplicate {rid}</h1>
        <RoleForm roleId={rid} action="duplicating" />
      </>
    </RoleFormWrapper>
  );
};

export default CustomRolePage;
