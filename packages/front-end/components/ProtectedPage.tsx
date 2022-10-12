import { useEffect, useState, createContext, ReactNode } from "react";
import {
  useAuth,
  UserOrganizations,
  getDefaultPermissions,
  safeLogout,
} from "../services/auth";
import LoadingOverlay from "./LoadingOverlay";
import WatchProvider from "../services/WatchProvider";
import CreateOrganization from "./Auth/CreateOrganization";
import track from "../services/track";
import {
  OrganizationSettings,
  Permissions,
  MemberRole,
  LicenseData,
} from "back-end/types/organization";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useRouter } from "next/router";
import { isCloud, isSentryEnabled } from "../services/env";
import InAppHelp from "./Auth/InAppHelp";
import Button from "./Button";
import { ThemeToggler } from "./Layout/ThemeToggler";
import * as Sentry from "@sentry/react";

type User = { id: string; email: string; name: string };

interface UserResponse {
  status: number;
  userId: string;
  userName: string;
  email: string;
  admin: boolean;
  organizations?: UserOrganizations;
  license?: LicenseData;
}

interface MembersResponse {
  users: User[];
}

let currentUser: null | {
  id: string;
  org: string;
  role: MemberRole;
} = null;
export function getCurrentUser() {
  return currentUser;
}

export type UserContextValue = {
  userId?: string;
  name?: string;
  email?: string;
  admin?: boolean;
  role?: string;
  license?: LicenseData;
  enterprise?: boolean;
  users?: Map<string, User>;
  getUserDisplay?: (id: string, fallback?: boolean) => string;
  update?: () => Promise<void>;
  refreshUsers?: () => Promise<void>;
  permissions: Permissions;
  settings: OrganizationSettings;
};

export const UserContext = createContext<UserContextValue>({
  permissions: getDefaultPermissions(),
  settings: {},
});

const ProtectedPage: React.FC<{
  organizationRequired: boolean;
  children: ReactNode;
}> = ({ children, organizationRequired }) => {
  const {
    isAuthenticated,
    apiCall,
    orgId,
    organizations,
    setOrganizations,
  } = useAuth();

  const [data, setData] = useState<UserResponse>(null);
  const [error, setError] = useState("");
  const [users, setUsers] = useState<Map<string, User>>(new Map());
  const router = useRouter();

  const update = async () => {
    try {
      const res = await apiCall<UserResponse>("/user", {
        method: "GET",
      });
      setData(res);
      if (res.organizations) {
        setOrganizations(res.organizations);
      }
    } catch (e) {
      setError(e.message);
    }
  };

  const refreshUsers = async () => {
    try {
      const res = await apiCall<MembersResponse>("/members", {
        method: "GET",
      });

      const userMap = new Map<string, User>();
      if (res.users) {
        res.users.forEach((user) => {
          userMap.set(user.id, user);
        });
      }
      setUsers(userMap);
    } catch (e) {
      setUsers(new Map());
    }
  };

  const currentOrg = organizations.filter((org) => org.id === orgId)[0];
  const role = data?.admin ? "admin" : currentOrg?.role || "readonly";
  const permissions = currentOrg?.permissions || getDefaultPermissions();

  // Super admins always have some basic permissions
  if (data?.admin) {
    permissions.organizationSettings = true;
    permissions.editDatasourceSettings = true;
  }

  useEffect(() => {
    currentUser = {
      org: orgId || "",
      id: data?.userId || "",
      role,
    };
    if (orgId) {
      refreshUsers();
      track("Organization Loaded");
    }
  }, [orgId]);

  // Once authenticated, get userId, orgId from API
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    update();
  }, [isAuthenticated]);

  const growthbook = useGrowthBook();
  useEffect(() => {
    growthbook.setAttributes({
      id: data?.userId || "",
      name: data?.userName || "",
      admin: data?.admin || false,
      company: currentOrg?.name || "",
      userAgent: window.navigator.userAgent,
      url: router?.pathname || "",
      cloud: isCloud(),
      enterprise: currentOrg?.enterprise || false,
      hasLicenseKey: !!data?.license,
      freeSeats: currentOrg?.freeSeats || 3,
      discountCode: currentOrg?.discountCode || "",
      hasActiveSubscription: !!currentOrg?.hasActiveSubscription,
    });
  }, [data, router?.pathname]);

  useEffect(() => {
    if (!data?.email) return;

    // Error tracking only enabled on GrowthBook Cloud
    if (isSentryEnabled()) {
      Sentry.setUser({ email: data.email, id: data.userId });
    }
  }, [data?.email]);

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
  if (!isAuthenticated || !data?.userId) {
    return <LoadingOverlay />;
  }

  // This page doesn't require an organization to load (e.g. accept invitation)
  if (!organizationRequired) {
    return <>{children}</>;
  }

  // Still waiting to fetch current user/org details
  if (data?.organizations?.length > 0 && !orgId) {
    return <LoadingOverlay />;
  }

  const userContextValue: UserContextValue = {
    userId: data?.userId,
    name: data?.userName,
    email: data?.email,
    admin: data?.admin,
    update,
    users,
    getUserDisplay: (id, fallback = true) => {
      const u = users.get(id);
      if (!u && fallback) return id;
      return u?.name || u?.email;
    },
    refreshUsers,
    role,
    permissions,
    settings: currentOrg?.settings || {},
    enterprise: currentOrg?.enterprise || false,
    license: data?.license,
  };

  return (
    <UserContext.Provider value={userContextValue} key={orgId}>
      <InAppHelp />
      {orgId ? (
        <WatchProvider>{children}</WatchProvider>
      ) : (
        <CreateOrganization />
      )}
    </UserContext.Provider>
  );
};

export default ProtectedPage;
