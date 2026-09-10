import { FC, ReactNode, useState } from "react";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth, safeLogout } from "@/services/auth";
import WatchProvider from "@/services/WatchProvider";
import { UserContextProvider, useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import LoadingOverlay from "./LoadingOverlay";
import CreateOrJoinOrganization from "./Auth/CreateOrJoinOrganization";
import SelectInitialPlan from "./Auth/SelectInitialPlan";
import InAppHelp from "./Auth/InAppHelp";
import TopNavLite from "./Layout/TopNavLite";

const LoggedInPageGuard = ({
  children,
  organizationRequired,
}: {
  children: ReactNode;
  organizationRequired: boolean;
}) => {
  const { error, ready, organization } = useUser();
  const { organizations, orgId, setOrgId } = useAuth();
  const [logoutError, setLogoutError] = useState<string | null>(null);

  // A bad organization selection (deleted org, revoked membership) fails every
  // org-scoped request, so switching orgs is the only way out of the error
  // screen short of logging out.
  const otherOrgs = (organizations || []).filter((o) => o.id !== orgId);

  if (error) {
    return (
      <div>
        <TopNavLite />
        <main className="container">
          <div className="mt-5 pt-5">
            <Box
              className="appbox"
              p="4"
              style={{ maxWidth: 500, margin: "auto" }}
            >
              <Heading as="h3" size="lg" mb="3">
                Something Went Wrong
              </Heading>
              <Callout status="error">{error}</Callout>
              {/* Ordered least to most destructive, so Log Out is never the
                  first thing a stuck user reaches for. */}
              <Flex align="center" justify="end" gap="3" mt="4">
                {setOrgId && otherOrgs.length > 0 ? (
                  <DropdownMenu
                    trigger={
                      <Button variant="soft">Switch Organization</Button>
                    }
                    menuPlacement="start"
                  >
                    <DropdownMenuLabel>Organization</DropdownMenuLabel>
                    {otherOrgs.map((o) => (
                      <DropdownMenuItem
                        key={o.id}
                        onClick={() => {
                          setOrgId(o.id);
                          try {
                            localStorage.setItem(
                              "gb-last-picked-org",
                              `"${o.id}"`,
                            );
                          } catch (e) {
                            console.warn(
                              "Unable to save last org in localStorage",
                            );
                          }
                        }}
                      >
                        {o.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenu>
                ) : null}
                <Button
                  variant="ghost"
                  onClick={() => {
                    window.location.reload();
                  }}
                >
                  Reload
                </Button>
                <Button
                  color="red"
                  setError={setLogoutError}
                  onClick={async () => {
                    await safeLogout();
                  }}
                >
                  Log Out
                </Button>
              </Flex>
              {logoutError ? (
                <Callout status="error" mt="3">
                  {logoutError}
                </Callout>
              ) : null}
            </Box>
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
