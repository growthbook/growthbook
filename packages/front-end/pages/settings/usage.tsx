import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CloudUsage from "@/components/Settings/Usage/CloudUsage";
import { useUser } from "@/services/UserContext";
import OrbPortal from "@/enterprise/components/Billing/OrbPortal";
import Callout from "@/ui/Callout";
import SettingsPage, {
  SettingsNoAccess,
} from "@/components/Layout/SettingsPage";

export default function UsagePage() {
  const permissionsUtil = usePermissionsUtil();
  const { subscription } = useUser();

  if (!permissionsUtil.canViewUsage()) {
    return <SettingsNoAccess title="Usage" />;
  }

  if (subscription?.isVercelIntegration) {
    return (
      <SettingsPage title="Usage">
        <Callout status="info">
          This page is not available for organizations whose plan is managed by
          Vercel. Please go to your Vercel Integration Dashboard to view your
          usage and billing information.
        </Callout>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      title="Usage"
      description="Invoices, payments, and plan usage."
      hideHeader={subscription?.billingPlatform !== "orb"}
    >
      {subscription?.billingPlatform === "orb" ? <OrbPortal /> : <CloudUsage />}
    </SettingsPage>
  );
}
