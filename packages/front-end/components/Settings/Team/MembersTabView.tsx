import { FC, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Separator } from "@radix-ui/themes";
import InviteList from "@/components/Settings/Team/InviteList";
import MemberList from "@/components/Settings/Team/MemberList";
import { redirectWithTimeout, useAuth } from "@/services/auth";
import SSOSettings from "@/components/Settings/SSOSettings";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import { useDefinitions } from "@/services/DefinitionsContext";
import { Select, SelectItem } from "@/ui/Select";
import OrphanedUsersList from "@/components/Settings/Team/OrphanedUsersList";
import PendingMemberList from "@/components/Settings/Team/PendingMemberList";
import { isCloud, isMultiOrg } from "@/services/env";
import AutoApproveMembersToggle from "@/components/Settings/Team/AutoApproveMembersToggle";
import DefaultRoleCard from "@/components/Settings/Team/DefaultRoleCard";
import VerifyingEmailModal from "@/components/Settings/UpgradeModal/VerifyingEmailModal";
import PleaseVerifyEmailModal from "@/components/Settings/UpgradeModal/PleaseVerifyEmailModal";
import LicenseSuccessModal from "@/components/Settings/UpgradeModal/LicenseSuccessModal";
import track from "@/services/track";
import PremiumCallout from "@/ui/PremiumCallout";
import Frame from "@/ui/Frame";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

// Radix Select reserves "" for no value.
const ALL_PROJECTS = "__all__";

export const MembersTabView: FC = () => {
  const {
    refreshOrganization,
    enterpriseSSO,
    organization,
    hasCommercialFeature,
    teams,
  } = useUser();

  const { project, projects } = useDefinitions();

  const [currentProject, setCurrentProject] = useState(project || "");
  const [error, setError] = useState("");

  const permissions = usePermissions();

  const router = useRouter();
  const { apiCall } = useAuth();
  const { license } = useUser();

  // Will be set when redirected here after Stripe Checkout
  const checkoutSessionId = String(
    router.query["subscription-success-session"] || "",
  );

  const [justSubscribedForPro, setJustSubscribedForPro] = useState(false);
  useEffect(() => {
    if (!checkoutSessionId) return;
    setJustSubscribedForPro(true);

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
      <Callout status="error">
        You do not have access to view this page.
      </Callout>
    );
  }

  const reenterEmailOnStripe = async () => {
    setError("");
    try {
      const res = await apiCall<{ url: string }>(`/subscription/manage`, {
        method: "POST",
      });
      if (res && res.url) {
        track("Renter email on Stripe");
        await redirectWithTimeout(res.url);
      } else {
        setError("Unknown response");
      }
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="pagecontents">
      <VerifyingEmailModal />
      {justSubscribedForPro && !isCloud() && !license?.emailVerified && (
        <PleaseVerifyEmailModal
          close={() => setJustSubscribedForPro(false)}
          plan="Pro"
          isTrial={false}
          error={error}
          reenterEmail={reenterEmailOnStripe}
        />
      )}
      {justSubscribedForPro && (isCloud() || license?.emailVerified) && (
        <LicenseSuccessModal
          plan={"Pro"}
          close={() => setJustSubscribedForPro(false)}
          header={`🎉 Welcome to Growthbook Pro`}
          isTrial={license?.isTrial}
        />
      )}
      <SSOSettings ssoConnection={ssoConnection || null} />
      {(isMultiOrg() || hasCommercialFeature("sso")) && (
        <Frame px="0" py="0" mb="4" overflow="hidden">
          {isMultiOrg() && (
            <AutoApproveMembersToggle mutate={refreshOrganization} />
          )}
          {isMultiOrg() && hasCommercialFeature("sso") && (
            <Separator size="4" />
          )}
          {hasCommercialFeature("sso") && <DefaultRoleCard />}
        </Frame>
      )}
      <MemberList
        mutate={refreshOrganization}
        project={currentProject}
        canEditRoles={true}
        canDeleteMembers={true}
        canInviteMembers={true}
        filters={
          projects.length > 0 ? (
            <Flex align="center" gap="2" flexShrink="0">
              <Text color="text-mid">Show roles for</Text>
              <Box width="200px">
                <Select
                  aria-label="Show roles for"
                  value={currentProject || ALL_PROJECTS}
                  setValue={(v) =>
                    setCurrentProject(v === ALL_PROJECTS ? "" : v)
                  }
                >
                  <SelectItem value={ALL_PROJECTS}>All Projects</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </Select>
              </Box>
            </Flex>
          ) : null
        }
      />
      {!teams?.length || !organization.customRoles?.length ? (
        <PremiumCallout
          commercialFeature="teams"
          id="member-list-team-promo"
          docSection="team"
          dismissible={true}
          mb="5"
        >
          <strong>Teams and Custom Roles</strong> can make permission management
          easier at scale.
        </PremiumCallout>
      ) : null}
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
    </div>
  );
};
