import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";

export function OrgSuspendedBannerContainer() {
  const { orgSuspended } = useUser();

  if (!orgSuspended) {
    return null;
  }

  return (
    <div className="contents pagecontents container mb-3">
      <Callout status="error">
        <strong>Account Suspended.</strong> Please contact your account manager
        or <a href="mailto:support@growthbook.io">support@growthbook.io</a> to
        regain access.
      </Callout>
    </div>
  );
}
