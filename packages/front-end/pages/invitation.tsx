import { useCallback, useEffect, useMemo } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import Button from "@/components/Button";
import LoadingOverlay from "@/components/LoadingOverlay";
import useApi from "@/hooks/useApi";
import { useAuth, redirectWithTimeout } from "@/services/auth";
import { trackPageView } from "@/services/track";
import Callout from "@/ui/Callout";

const InvitationPage = (): React.ReactElement => {
  const { t } = useLingui();
  const { apiCall } = useAuth();

  // Extract the invitation key from the querystring
  const key = useMemo(
    () => (window.location.search.match(/(^|&|\?)key=([a-zA-Z0-9]+)/) || [])[2],
    [],
  );

  // This page is before the user is part of an org, so need to manually fire a page load event
  useEffect(() => {
    trackPageView("/invitation");
  }, []);

  // Get data about the invitation
  const { data, error: keyError } = useApi<{
    organization: string;
    role: string;
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
          t`There was an error accepting the invite. Please go back to your email and click the invite link again.`,
      );
    }
  }, [apiCall, t]);

  const error = !key
    ? t`Missing required invite key parameter in URL. Please go back to your email and click the invite link again.`
    : keyError?.message;
  if (error) {
    return <Callout status="error">{error}</Callout>;
  }

  if (!data) {
    return <LoadingOverlay />;
  }

  const organization = data.organization;
  const role = data.role;

  return (
    <div className="appbox p-4" style={{ maxWidth: 500, margin: "auto" }}>
      <h3 className="mb-3">
        <Trans>Accept Invitation</Trans>
      </h3>
      <div className="mb-3">
        {role?.match(/^[aeiou]/i) ? (
          <Trans>
            You&apos;ve been invited to join <strong>{organization}</strong> on
            GrowthBook as an {role}!
          </Trans>
        ) : (
          <Trans>
            You&apos;ve been invited to join <strong>{organization}</strong> on
            GrowthBook as a {role}!
          </Trans>
        )}
      </div>
      <div className="d-flex">
        <Button color="primary" onClick={acceptInvite} className="ml-auto">
          <Trans>Accept Invitation</Trans>
        </Button>
      </div>
    </div>
  );
};

InvitationPage.noOrganization = true;

export default InvitationPage;
