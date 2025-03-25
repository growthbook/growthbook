import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CloudUsage from "@/components/Settings/Usage/CloudUsage";
import { useUser } from "@/services/UserContext";
import OrbPortal from "@/enterprise/components/Billing/OrbPortal";

export default function UsagePage() {
  const permissionsUtil = usePermissionsUtil();
  const { subscription, organization } = useUser();

  if (!permissionsUtil.canViewUsage()) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      {subscription?.billingPlatform === "orb" && organization.id ? (
        <OrbPortal orgId={organization.id} />
      ) : (
        <CloudUsage />
      )}
    </div>
  );
}
