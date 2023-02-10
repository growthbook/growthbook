import Link from "next/link";
import React, { FC, useEffect, useState } from "react";
import { FaAngleLeft, FaQuestionCircle } from "react-icons/fa";
import { useRouter } from "next/router";
import InviteList from "@/components/Settings/Team/InviteList";
import MemberList from "@/components/Settings/Team/MemberList";
import { useAuth } from "@/services/auth";
import SSOSettings from "@/components/Settings/SSOSettings";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import OrphanedUsersList from "@/components/Settings/Team/OrphanedUsersList";
import PendingMemberList from "@/components/Settings/Team/PendingMemberList";
import Toggle from "@/components/Forms/Toggle";
import { isCloud } from "@/services/env";
import Tooltip from "@/components/Tooltip/Tooltip";
import track from "@/services/track";

const TeamPage: FC = () => {
  const { refreshOrganization, enterpriseSSO, organization } = useUser();

  const { project, projects } = useDefinitions();

  const [currentProject, setCurrentProject] = useState(project || "");
  const [togglingAutoApprove, setTogglingAutoApprove] = useState(false);

  const permissions = usePermissions();

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
        refreshOrganization();
        router.replace(router.pathname, router.pathname, { shallow: true });
      })
      .catch((e) => {
        console.error(e);
      });
  }, [checkoutSessionId]);

  const ssoConnection = enterpriseSSO;

  if (!permissions.manageTeam) {
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
      <SSOSettings ssoConnection={ssoConnection} />
      <h1>Team Members</h1>
      {projects.length > 0 && (
        <div className="row align-items-center">
          <div className="col-auto">View roles and permissions for</div>
          <div className="col-auto">
            <SelectField
              value={currentProject}
              onChange={(value) => setCurrentProject(value)}
              options={projects.map((p) => ({
                label: p.name,
                value: p.id,
              }))}
              initialOption="All Projects"
            />
          </div>
        </div>
      )}
      {isCloud() && (
        <div className="mt-3">
          <Toggle
            id="autoApproveMembers"
            value={!!organization?.autoApproveMembers}
            disabled={!permissions.manageTeam}
            setValue={async (on) => {
              if (togglingAutoApprove) return;
              if (on && organization?.autoApproveMembers) return;
              if (!on && !organization?.autoApproveMembers) return;

              setTogglingAutoApprove(true);
              try {
                await apiCall(`/organization/autoApproveMembers`, {
                  method: "POST",
                  body: JSON.stringify({
                    state: on,
                  }),
                });
                track("Set auto approve members", {
                  enabled: on,
                });
              } catch (e) {
                console.error(e);
              }
              setTogglingAutoApprove(false);
              await refreshOrganization();
            }}
          />
          <div className="ml-1" style={{display: "inline-block", verticalAlign: "middle"}}>
            <Tooltip body="When new members register using a verified email address matching this organization, automatically add them as active members.">
              Automatically approve new verified users{" "}
              <FaQuestionCircle />
            </Tooltip>
            <div className="small">Requires this organization&apos;s owner to have a verified email address.</div>
          </div>
        </div>
      )}
      <MemberList mutate={refreshOrganization} project={currentProject} />
      {organization?.pendingMembers?.length > 0 && (
        <PendingMemberList
          pendingMembers={organization.pendingMembers}
          mutate={refreshOrganization}
          project={currentProject}
        />
      )}
      {organization.invites.length > 0 && (
        <InviteList
          invites={organization.invites}
          mutate={refreshOrganization}
          project={currentProject}
        />
      )}

      <OrphanedUsersList
        mutateUsers={refreshOrganization}
        numUsersInAccount={organization.members?.length || 0}
      />
    </div>
  );
};
export default TeamPage;
