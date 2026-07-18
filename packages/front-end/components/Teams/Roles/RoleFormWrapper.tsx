import { ReactNode } from "react";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";

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
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </div>
    );
  }

  if (!hasCustomRolesFeature) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          Custom Roles are only available on the Enterprise plan. Email
          sales@growthbook.io for more information and to set up a call.
        </Callout>
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
