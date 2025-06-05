import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CloudUsage from "@/components/Settings/Usage/CloudUsage";
import { useUser } from "@/services/UserContext";
import OrbPortal from "@/enterprise/components/Billing/OrbPortal";

export default function UsagePage() {
  const permissionsUtil = usePermissionsUtil();
  const { subscription } = useUser();

  if (!permissionsUtil.canViewUsage()) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  if (subscription?.isVercelIntegration) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-info">
          This page is not available for organizations whose plan is managed by
          Vercel. Please go to your Vercel Integration Dashboard to view your
          usage and billing information.
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      {subscription?.billingPlatform === "orb" ? <OrbPortal /> : <CloudUsage />}
    </div>
  );
}
