import { useUser } from "@/services/UserContext";

export function OrgSuspendedBannerContainer() {
  const { orgSuspended } = useUser();

  if (!orgSuspended) {
    return null;
  }

  return (
    <div className="contents pagecontents container mb-3">
      <div className="alert alert-danger">
        <strong>Account Suspended.</strong> This organization has been suspended
        and access is restricted. Please contact{" "}
        <a href="mailto:support@growthbook.io">support@growthbook.io</a> for
        assistance.
      </div>
    </div>
  );
}
