import { ReactNode } from "react";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

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
