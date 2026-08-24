import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CloudUsage from "@/components/Settings/Usage/CloudUsage";
import { useUser } from "@/services/UserContext";
import OrbPortal from "@/enterprise/components/Billing/OrbPortal";
import Callout from "@/ui/Callout";

export default function UsagePage() {
  const permissionsUtil = usePermissionsUtil();
  const { subscription } = useUser();

  if (!permissionsUtil.canViewUsage()) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </div>
    );
  }

  if (subscription?.isVercelIntegration) {
    return (
      <div className="container pagecontents">
        <Callout status="info">
          This page is not available for organizations whose plan is managed by
          Vercel. Please go to your Vercel Integration Dashboard to view your
          usage and billing information.
        </Callout>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      {subscription?.billingPlatform === "orb" ? <OrbPortal /> : <CloudUsage />}
    </div>
  );
}
