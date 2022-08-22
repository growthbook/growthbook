import Link from "next/link";
import { FC, useEffect, useState } from "react";
import { FaAngleLeft } from "react-icons/fa";
import LoadingOverlay from "../../components/LoadingOverlay";
import InviteList from "../../components/Settings/InviteList";
import MemberList, { MemberInfo } from "../../components/Settings/MemberList";
import useApi from "../../hooks/useApi";
import { useRouter } from "next/router";
import { useAuth } from "../../services/auth";
import { OrganizationInterface } from "back-end/types/organization";

const TeamPage: FC = () => {
  const { data, error, mutate } = useApi<{
    organization: OrganizationInterface & { members: MemberInfo[] };
  }>(`/organization`);

  const router = useRouter();
  const { apiCall } = useAuth();

  // Will be set when redirected here after Stripe Checkout
  const checkoutSessionId = String(
    router.query["subscription-success-session"] || ""
  );

  const [justSubscribed, setJustSubscribed] = useState(false);
  useEffect(() => {
    if (!checkoutSessionId) return;
    setJustSubscribed(true);

    // Ensure database has the subscription (in case the Stripe webhook failed)
    apiCall(`/subscription/success`, {
      method: "POST",
      body: JSON.stringify({
        checkoutSessionId,
      }),
    })
      .then(() => {
        mutate();
        router.replace(router.pathname, router.pathname, { shallow: true });
      })
      .catch((e) => {
        console.error(e);
      });
  }, [checkoutSessionId]);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container-fluid pagecontents">
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      {justSubscribed && (
        <div className="alert alert-success mb-4">
          <h3>Welcome to GrowthBook Pro!</h3>
          <div>You can now invite more team members to your account.</div>
        </div>
      )}
      <h1>Team Members</h1>
      <MemberList members={data.organization.members} mutate={mutate} />
      {data.organization.invites.length > 0 ? (
        <InviteList invites={data.organization.invites} mutate={mutate} />
      ) : (
        ""
      )}
    </div>
  );
};
export default TeamPage;
