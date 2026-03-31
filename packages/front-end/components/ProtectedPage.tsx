import { ReactNode } from "react";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { useAuth, safeLogout } from "@/services/auth";
import WatchProvider from "@/services/WatchProvider";
import { UserContextProvider, useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import {
  getProtectedPageErrorState,
} from "@/services/protectedPageError";
import LoadingOverlay from "./LoadingOverlay";
import CreateOrJoinOrganization from "./Auth/CreateOrJoinOrganization";
import SelectInitialPlan from "./Auth/SelectInitialPlan";
import InAppHelp from "./Auth/InAppHelp";
import Button from "./Button";
import TopNavLite from "./Layout/TopNavLite";

const LoggedInPageGuard = ({
  children,
  organizationRequired,
}: {
  children: ReactNode;
  organizationRequired: boolean;
}) => {
  const { error, ready, organization } = useUser();
  const { organizations } = useAuth();
  const errorState = getProtectedPageErrorState({ error, ready: !!ready });

  if (errorState === "sign_in_error") {
    return (
      <div>
        <TopNavLite />
        <main className="container">
          <div className="mt-5 pt-5">
            <div
              className="appbox p-4"
              style={{ maxWidth: 500, margin: "auto" }}
            >
              <h3 className="mb-3">Error Signing In</h3>
              <div className="alert alert-danger">{error}</div>
              <div className="d-flex">
                <Button
                  className="ml-auto"
                  onClick={async () => {
                    await safeLogout();
                  }}
                  color="danger"
                >
                  Log Out
                </Button>
                <button
                  className="btn btn-link"
                  onClick={(e) => {
                    e.preventDefault();
                    window.location.reload();
                  }}
                >
                  Reload
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // During startup, transient transport failures can happen while the app revalidates.
  // Keep showing loading instead of surfacing a misleading auth error flash.
  if (errorState === "startup_network_error") {
    return <LoadingOverlay />;
  }

  if (errorState === "connection_error") {
    return (
      <div>
        <TopNavLite />
        <main className="container">
          <div className="mt-5 pt-5">
            <div
              className="appbox p-4"
              style={{ maxWidth: 500, margin: "auto" }}
            >
              <h3 className="mb-3">Connection Error</h3>
              <div className="alert alert-warning">
                Couldn&apos;t reach the GrowthBook API. Please try again.
              </div>
              <div className="d-flex">
                <button
                  className="btn btn-link ml-auto"
                  onClick={(e) => {
                    e.preventDefault();
                    window.location.reload();
                  }}
                >
                  Reload
                </button>
              </div>
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

const ProtectedPage: React.FC<{
  organizationRequired: boolean;
  children: ReactNode;
}> = ({ children, organizationRequired }) => {
  const { effectiveAccountPlan } = useUser();
  const { orgId, initialPlanSelection } = useAuth();
  const initialPlanSelectionEnabled = useFeatureIsOn("pro-signup-flow");

  const paidPlans = ["pro", "pro_sso", "enterprise"];
  const hasExistingPaidPlan =
    !!effectiveAccountPlan && paidPlans.includes(effectiveAccountPlan);

  const showSelectPlanFlow =
    orgId &&
    initialPlanSelectionEnabled &&
    initialPlanSelection &&
    isCloud() &&
    !hasExistingPaidPlan;

  return (
    <UserContextProvider key={orgId}>
      <LoggedInPageGuard organizationRequired={organizationRequired}>
        <InAppHelp />
        {!organizationRequired ? (
          <>{children}</>
        ) : showSelectPlanFlow ? (
          <SelectInitialPlan />
        ) : orgId ? (
          <WatchProvider>{children}</WatchProvider>
        ) : (
          <CreateOrJoinOrganization />
        )}
      </LoggedInPageGuard>
    </UserContextProvider>
  );
};

export default ProtectedPage;
