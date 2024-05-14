import { FC } from "react";
import PageHead from "@/components/Layout/PageHead";
import RoleForm from "@/components/Teams/Roles/RoleForm";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const NewCustomRolePage: FC = () => {
  const permissionsUtil = usePermissionsUtil();

  if (!permissionsUtil.canManageTeam) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }
  return (
    <>
      <PageHead
        breadcrumb={[
          {
            display: "Members",
            href: `/settings/team#roles`,
          },
          { display: "Create Custom Role" },
        ]}
      />
      <div className="contents container pagecontents">
        <RoleForm />
      </div>
    </>
  );
};

export default NewCustomRolePage;
