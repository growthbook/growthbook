import { ReactNode } from "react";
import { useAuth, safeLogout } from "../services/auth";
import LoadingOverlay from "./LoadingOverlay";
import WatchProvider from "../services/WatchProvider";
import CreateOrganization from "./Auth/CreateOrganization";
import InAppHelp from "./Auth/InAppHelp";
import Button from "./Button";
import { ThemeToggler } from "./Layout/ThemeToggler/ThemeToggler";
import { UserContextProvider, useUser } from "../services/UserContext";

const LoggedInPageGuard = ({
  children,
  organizationRequired,
}: {
  children: ReactNode;
  organizationRequired: boolean;
}) => {
  const { error, userId, organization } = useUser();
  const { organizations } = useAuth();

  if (error) {
    return (
      <div>
        <div className="navbar bg-white border-bottom">
          <div>
            <img
              alt="GrowthBook"
              src="/logo/growthbook-logo.png"
              style={{ height: 36 }}
            />
          </div>
          <div className="ml-auto">
            <ThemeToggler />
          </div>
          <div>
            <Button
              className="ml-auto"
              onClick={async () => {
                await safeLogout();
              }}
              color="danger"
            >
              Log Out
            </Button>
          </div>
        </div>
        <div className="container mt-5">
          <div className="appbox p-4" style={{ maxWidth: 500, margin: "auto" }}>
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
      </div>
    );
  }

  // Waiting for initial authentication
  if (!userId) {
    return <LoadingOverlay />;
  }

  // This page doesn't require an organization to load (e.g. accept invitation)
  if (!organizationRequired) {
    return <>{children}</>;
  }

  // Still waiting to fetch current user/org details
  if (organizations?.length > 0 && !organization) {
    return <LoadingOverlay />;
  }

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
          <WatchProvider>{children}</WatchProvider>
        ) : (
          <CreateOrganization />
        )}
      </LoggedInPageGuard>
    </UserContextProvider>
  );
};

export default ProtectedPage;
