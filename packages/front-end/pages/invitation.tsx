import { MemberRole } from "back-end/types/organization";
import { useCallback, useMemo } from "react";
import Button from "../components/Button";
import LoadingOverlay from "../components/LoadingOverlay";
import useApi from "../hooks/useApi";
import { useAuth, redirectWithTimeout } from "../services/auth";

const InvitationPage = (): React.ReactElement => {
  const { apiCall } = useAuth();

  // Extract the invitation key from the querystring
  const key = useMemo(
    () => window?.location.search.match(/(^|&|\?)key=([a-zA-Z0-9]+)/)[2],
    []
  );

  // Get data about the invitation
  const { data, error: keyError } = useApi<{
    organization: string;
    role: MemberRole;
  }>(`/invite/${key}`);

  // Click handler for accept button
  const acceptInvite = useCallback(async () => {
    if (!key) return;

    const res = await apiCall<{
      status: number;
      orgId?: string;
      message?: string;
    }>(`/invite/accept`, {
      method: "POST",
      body: JSON.stringify({
        key,
      }),
    });
    if (res.orgId) {
      await redirectWithTimeout(`/?org=${res.orgId}`);
    } else {
      throw new Error(
        res.message ||
          "There was an error accepting the invite. Please go back to your email and click the invite link again."
      );
    }
  }, [apiCall]);

  const error = !key
    ? "Missing required invite key parameter in URL. Please go back to your email and click the invite link again."
    : keyError?.message;
  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }

  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div className="appbox p-4" style={{ maxWidth: 500, margin: "auto" }}>
      <h3 className="mb-3">Accept Invitation</h3>
      <div className="mb-3">
        You&apos;ve been invited to join <strong>{data.organization}</strong> on
        GrowthBook as {data.role?.match(/^[aeiou]/i) ? "an" : "a"} {data.role}!
      </div>
      <div className="d-flex">
        <Button color="primary" onClick={acceptInvite} className="ml-auto">
          Accept Invitation
        </Button>
      </div>
    </div>
  );
};

InvitationPage.noOrganization = true;

export default InvitationPage;
