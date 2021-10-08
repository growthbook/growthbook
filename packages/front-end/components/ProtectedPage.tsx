import { useEffect, useState, createContext } from "react";
import {
  useAuth,
  UserOrganizations,
  MemberRole,
  SubscriptionStatus,
} from "../services/auth";
import LoadingOverlay from "./LoadingOverlay";
import WatchProvider from "../services/WatchProvider";
import CreateOrganization from "./Auth/CreateOrganization";
import UnverifiedPage from "../pages/unverified";
import md5 from "md5";
import track from "../services/track";
import { OrganizationSettings } from "back-end/types/organization";

type User = { id: string; email: string; name: string };

interface UserResponse {
  status: number;
  userId: string;
  userName: string;
  email: string;
  admin: boolean;
  isVerified?: boolean;
  organizations?: UserOrganizations;
}

interface MembersResponse {
  users: User[];
}

export type Permissions = {
  draftExperiments?: boolean;
  runExperiments?: boolean;
  createMetrics?: boolean;
  organizationSettings?: boolean;
};
function getPermissionsByRole(role: MemberRole): Permissions {
  const permissions: Permissions = {};
  switch (role) {
    case "admin":
      permissions.organizationSettings = true;
    // falls through
    case "developer":
      permissions.runExperiments = true;
      permissions.createMetrics = true;
    // falls through
    case "designer":
      permissions.draftExperiments = true;
  }
  return permissions;
}

export type UserContextValue = {
  userId?: string;
  name?: string;
  email?: string;
  admin?: boolean;
  isVerified?: boolean;
  role?: string;
  users?: Map<string, User>;
  getUserDisplay?: (id: string, fallback?: boolean) => string;
  update?: () => Promise<void>;
  refreshUsers?: () => Promise<void>;
  permissions: Permissions;
  subscriptionStatus?: SubscriptionStatus;
  trialEnd?: Date;
  settings: OrganizationSettings;
};

export const UserContext = createContext<UserContextValue>({
  permissions: {},
  settings: {},
});

const ProtectedPage: React.FC<{
  organizationRequired: boolean;
  preAuth: boolean;
}> = ({ children, organizationRequired, preAuth }) => {
  const {
    loading,
    isAuthenticated,
    login,
    apiCall,
    orgId,
    organizations,
    setOrganizations,
  } = useAuth();

  const [data, setData] = useState<UserResponse>(null);
  const [users, setUsers] = useState<Map<string, User>>(new Map());

  const update = async () => {
    const res = await apiCall<UserResponse>("/user", {
      method: "GET",
    });
    setData(res);
    if (res.organizations) {
      setOrganizations(res.organizations);
    }
  };

  const refreshUsers = async () => {
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
  };

  useEffect(() => {
    // Anonymous hash of the orgId for telemetry data
    window["gbOrgHash"] = orgId ? md5(orgId) : "";
    if (orgId) {
      refreshUsers();
      track("Organization Loaded");
    }
  }, [orgId]);

  // Initial authentication
  useEffect(() => {
    if (loading || isAuthenticated || preAuth) {
      return;
    }
    const fn = async () => {
      await login();
    };
    fn();
  }, [loading, isAuthenticated, preAuth, login]);

  // Once authenticated, get userId, orgId from API
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    update();
  }, [isAuthenticated]);

  const currentOrg = organizations.filter((org) => org.id === orgId)[0];
  const role = data?.admin ? "admin" : currentOrg?.role || "collaborator";
  const isVerified = role === "admin" ? true : data?.isVerified ?? false;

  // This page is before the user is authenticated (e.g. reset password)
  if (preAuth) {
    return <>{children}</>;
  }

  // Waiting for initial authentication
  if (!isAuthenticated || !data?.userId) {
    return <LoadingOverlay />;
  }

  if (isVerified) {
    // This page doesn't require an organization to load (e.g. accept invitation)
    if (!organizationRequired) {
      return <>{children}</>;
    }

    // Still waiting to fetch current user/org details
    if (data?.organizations?.length > 0 && !orgId) {
      return <LoadingOverlay />;
    }
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
    subscriptionStatus: currentOrg?.subscriptionStatus || "active",
    trialEnd: currentOrg?.trialEnd,
    permissions: getPermissionsByRole(role),
    settings: currentOrg?.settings || {},
  };

  // User is not yet verified
  if (!isVerified) {
    return (
      <UserContext.Provider value={userContextValue} key={orgId}>
        <UnverifiedPage />
      </UserContext.Provider>
    );
  }

  return (
    <UserContext.Provider value={userContextValue} key={orgId}>
      {orgId ? (
        <WatchProvider>{children}</WatchProvider>
      ) : (
        <CreateOrganization />
      )}
    </UserContext.Provider>
  );
};

export default ProtectedPage;
