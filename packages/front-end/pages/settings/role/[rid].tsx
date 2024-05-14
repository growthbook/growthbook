import { FC } from "react";
import router from "next/router";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import RoleForm from "@/components/Teams/Roles/RoleForm";

const CustomRolePage: FC = () => {
  const { rid } = router.query;
  const permissionsUtil = usePermissionsUtil();

  //MKTODO: Is there a better way to do this?
  if (!rid || Array.isArray(rid)) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

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
          { display: `${rid}` },
        ]}
      />
      <RoleForm roleId={rid} />
    </>
  );
};

export default CustomRolePage;
