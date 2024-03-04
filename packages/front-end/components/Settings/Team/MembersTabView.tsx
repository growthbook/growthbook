import { FC, useEffect, useState } from "react";
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
import { isCloud, isMultiOrg } from "@/services/env";
import AutoApproveMembersToggle from "@/components/Settings/Team/AutoApproveMembersToggle";
import UpdateDefaultRoleForm from "@/components/Settings/Team/UpdateDefaultRoleForm";
import VerifyingEmailModal from "../UpgradeModal/VerifyingEmailModal";
import PleaseVerifyEmailModal from "../UpgradeModal/PleaseVerifyEmailModal";
import LicenseSuccessModal from "../UpgradeModal/LicenseSuccessModal";

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
  const { license } = useUser();

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
      <VerifyingEmailModal />
      {justSubscribed && !isCloud() && !license?.emailVerified && (
        <PleaseVerifyEmailModal close={close} plan="Pro" isTrial={false} />
      )}
      {justSubscribed && (isCloud() || license?.emailVerified) && (
        <LicenseSuccessModal
          plan={license?.plan === "enterprise" ? "Enterprise" : "Pro"}
          close={() => setJustSubscribed(false)}
          header={`🎉 Welcome to Growthbook ${
            license?.plan === "enterprise" ? "Enterprise" : "Pro"
          }`}
          isTrial={license?.isTrial}
        />
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
        organization.pendingMembers &&
        organization.pendingMembers.length > 0 && (
          <PendingMemberList
            pendingMembers={organization.pendingMembers}
            mutate={refreshOrganization}
            project={currentProject}
          />
        )}
      {organization &&
        organization.invites &&
        organization.invites.length > 0 && (
          <InviteList
            invites={organization.invites}
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
