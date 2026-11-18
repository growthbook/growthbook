import { FC, ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { useAuth, safeLogout, switchToSSO } from "@/services/auth";
import WatchProvider from "@/services/WatchProvider";
import { UserContextProvider, useUser } from "@/services/UserContext";
import { isCloud, usingSSO } from "@/services/env";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import LoadingOverlay from "./LoadingOverlay";
import CreateOrJoinOrganization from "./Auth/CreateOrJoinOrganization";
import SelectInitialPlan from "./Auth/SelectInitialPlan";
import InAppHelp from "./Auth/InAppHelp";
import MfaEnrollment from "./Auth/MfaEnrollment";
import TopNavLite from "./Layout/TopNavLite";

const LoggedInPageGuard = ({
  children,
  organizationRequired,
}: {
  children: ReactNode;
  organizationRequired: boolean;
}) => {
  const {
    error,
    requiredSSOConnectionId,
    mfaRequired,
    mfaEnabled,
    ready,
    organization,
  } = useUser();
  const { organizations } = useAuth();

  if (mfaRequired) {
    return (
      <div>
        <TopNavLite />
        <main className="container">
          <div className="mt-5 pt-5">
            <div
              className="appbox p-4"
              style={{ maxWidth: 500, margin: "auto" }}
            >
              <h3 className="mb-3">MFA Required</h3>
              <Callout status="info" mb="3">
                {usingSSO()
                  ? "Your organization requires multi-factor authentication (MFA). Log out, then sign in again using MFA with your identity provider."
                  : mfaEnabled
                    ? "Your organization requires multi-factor authentication (MFA). Log out, then log back in with a code from your authenticator app."
                    : "Your organization requires multi-factor authentication (MFA). Set it up to continue."}
              </Callout>
              {!usingSSO() && !mfaEnabled && <MfaEnrollment />}
              <Flex justify="end" mt="3">
                <Button variant="ghost" onClick={safeLogout}>
                  Log out
                </Button>
              </Flex>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <TopNavLite />
        <main className="container">
          <div className="mt-5 pt-5">
            <div
              className="appbox p-4"
              style={{ maxWidth: 500, margin: "auto" }}
            >
              <h3 className="mb-3">
                {requiredSSOConnectionId
                  ? "Enterprise SSO Required"
                  : "Something Went Wrong"}
              </h3>
              <Callout status={requiredSSOConnectionId ? "info" : "error"}>
                {error}
              </Callout>
              <Flex justify="end" align="center" gap="3" mt="3">
                {requiredSSOConnectionId ? (
                  <>
                    <Button variant="ghost" onClick={safeLogout}>
                      Log out
                    </Button>
                    <Button
                      onClick={() => switchToSSO(requiredSSOConnectionId)}
                    >
                      Sign in with Enterprise SSO
                    </Button>
                  </>
                ) : (
                  <>
                    <Button color="red" onClick={safeLogout}>
                      Log out
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => window.location.reload()}
                    >
                      Reload
                    </Button>
                  </>
                )}
              </Flex>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Waiting for initial authentication
  if (!ready) {
    return <LoadingOverlay />;
  }

  // This page doesn't require an organization to load (e.g. accept invitation)
  if (!organizationRequired) {
    return <>{children}</>;
  }

  // Still waiting to fetch current user/org details
  if ((organizations || []).length > 0 && !Object.keys(organization).length) {
    return <LoadingOverlay />;
  }

  return <>{children}</>;
};

const InitialPlanGate: FC<{ children: ReactNode }> = ({ children }) => {
  const { effectiveAccountPlan } = useUser();
  const { initialPlanSelection } = useAuth();
  const initialPlanSelectionEnabled = useFeatureIsOn("pro-signup-flow");

  const hasExistingPaidPlan =
    !!effectiveAccountPlan &&
    ["pro", "pro_sso", "enterprise"].includes(effectiveAccountPlan);

  const showSelectPlanFlow =
    initialPlanSelectionEnabled &&
    !!initialPlanSelection &&
    isCloud() &&
    !hasExistingPaidPlan;

  if (showSelectPlanFlow) return <SelectInitialPlan />;
  return <>{children}</>;
};

const ProtectedPage: React.FC<{
  organizationRequired: boolean;
  children: ReactNode;
}> = ({ children, organizationRequired }) => {
  const { orgId } = useAuth();

  return (
    <UserContextProvider key={orgId}>
      <LoggedInPageGuard organizationRequired={organizationRequired}>
        <InAppHelp />
        {!organizationRequired ? (
          <>{children}</>
        ) : orgId ? (
          <InitialPlanGate>
            <WatchProvider>{children}</WatchProvider>
          </InitialPlanGate>
        ) : (
          <CreateOrJoinOrganization />
        )}
      </LoggedInPageGuard>
    </UserContextProvider>
  );
};

export default ProtectedPage;
