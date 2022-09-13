import { useEffect, useState, createContext } from "react";
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
  LicenceData,
} from "back-end/types/organization";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useRouter } from "next/router";
import { isCloud } from "../services/env";
import InAppHelp from "./Auth/InAppHelp";
import Modal from "./Modal";
import { ReactNode } from "react";

type User = { id: string; email: string; name: string };

interface UserResponse {
  status: number;
  userId: string;
  userName: string;
  email: string;
  admin: boolean;
  organizations?: UserOrganizations;
  licence?: LicenceData;
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
  licence?: LicenceData;
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
      hasLicenceKey: !!data?.licence,
      freeSeats: currentOrg?.freeSeats || 3,
      discountCode: currentOrg?.discountCode || "",
      hasActiveSubscription: !!currentOrg?.hasActiveSubscription,
    });
  }, [data, router?.pathname]);

  if (error) {
    return (
      <Modal
        inline={true}
        open={true}
        cta="Log Out"
        submit={async () => {
          await safeLogout();
        }}
        submitColor="danger"
        closeCta="Reload"
        close={() => {
          window.location.reload();
        }}
        autoCloseOnSubmit={false}
      >
        <h3>Error signing in</h3>
        <div className="alert alert-danger">{error}</div>
      </Modal>
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
    licence: data?.licence,
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
