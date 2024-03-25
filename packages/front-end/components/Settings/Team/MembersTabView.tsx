import { FC, useEffect, useState } from "react";
import { useRouter } from "next/router";
import InviteList from "@front-end/components/Settings/Team/InviteList";
import MemberList from "@front-end/components/Settings/Team/MemberList";
import { useAuth } from "@front-end/services/auth";
import SSOSettings from "@front-end/components/Settings/SSOSettings";
import { useUser } from "@front-end/services/UserContext";
import usePermissions from "@front-end/hooks/usePermissions";
import { useDefinitions } from "@front-end/services/DefinitionsContext";
import SelectField from "@front-end/components/Forms/SelectField";
import OrphanedUsersList from "@front-end/components/Settings/Team/OrphanedUsersList";
import PendingMemberList from "@front-end/components/Settings/Team/PendingMemberList";
import { isMultiOrg } from "@front-end/services/env";
import AutoApproveMembersToggle from "@front-end/components/Settings/Team/AutoApproveMembersToggle";
import UpdateDefaultRoleForm from "@front-end/components/Settings/Team/UpdateDefaultRoleForm";

export const MembersTabView: FC = () => {
  const {
    refreshOrganization,
    enterpriseSSO,
    organization,
    hasCommercialFeature,
  } = useUser();

  const { project, projects } = useDefinitions();

  const [currentProject, setCurrentProject] = useState(project || "");

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
  }, [apiCall, checkoutSessionId, refreshOrganization, router]);

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
      {justSubscribed && (
        <div className="alert alert-success mb-4">
          <h3>Welcome to GrowthBook Pro!</h3>
          <div>You can now invite more team members to your account.</div>
        </div>
      )}
      <SSOSettings ssoConnection={ssoConnection || null} />
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
      {isMultiOrg() && (
        <AutoApproveMembersToggle mutate={refreshOrganization} />
      )}
      <MemberList
        mutate={refreshOrganization}
        project={currentProject}
        canEditRoles={true}
        canDeleteMembers={true}
        canInviteMembers={true}
      />
      {organization &&
        organization.invites &&
        organization.invites.length > 0 && (
          <InviteList
            invites={organization.invites}
            mutate={refreshOrganization}
            project={currentProject}
          />
        )}
      {organization &&
        organization.pendingMembers &&
        organization.pendingMembers.length > 0 && (
          <PendingMemberList
            pendingMembers={organization.pendingMembers}
            mutate={refreshOrganization}
            project={currentProject}
          />
        )}
      {!isMultiOrg() && (
        <OrphanedUsersList
          mutateUsers={refreshOrganization}
          numUsersInAccount={organization.members?.length || 0}
        />
      )}
      {hasCommercialFeature("sso") ? <UpdateDefaultRoleForm /> : null}
    </div>
  );
};
