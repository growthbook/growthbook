import { ReactNode } from "react";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";

export default function RoleFormWrapper({
  children,
  href,
  display,
  breadcrumb,
}: {
  children: ReactNode;
  href: string;
  display: string;
  breadcrumb: string;
}) {
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const hasCustomRolesFeature = hasCommercialFeature("custom-roles");

  if (!permissionsUtil.canManageTeam()) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  if (!hasCustomRolesFeature) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          Custom Roles are only available on the Enterprise plan. Email
          sales@growthbook.io for more information and to set up a call.
        </div>
      </div>
    );
  }
  return (
    <>
      <PageHead
        breadcrumb={[
          {
            display,
            href,
          },
          { display: breadcrumb },
        ]}
      />
      <div className="contents container pagecontents">{children}</div>
    </>
  );
}
