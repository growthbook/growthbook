import { useGrowthBook } from "@growthbook/growthbook-react";
import { ApiKeyInterface } from "back-end/types/apikey";
import {
  AccountPlan,
  AccountPlanFeature,
  EnvScopedPermission,
  GlobalPermission,
  LicenseData,
  MemberRole,
  OrganizationInterface,
  OrganizationSettings,
  Permission,
} from "back-end/types/organization";
import { SSOConnectionInterface } from "back-end/types/sso-connection";
import { useRouter } from "next/router";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { MemberInfo } from "../components/Settings/MemberList";
import { useAuth, UserOrganizations } from "./auth";
import { isCloud, isSentryEnabled } from "./env";
import track from "./track";
import * as Sentry from "@sentry/react";

type OrgSettingsResponse = {
  organization: OrganizationInterface & { members: MemberInfo[] };
  apiKeys: ApiKeyInterface[];
  enterpriseSSO: SSOConnectionInterface | null;
  role: MemberRole;
  permissions: Permission[];
  accountPlan: AccountPlan;
  accountPlanFeatures: AccountPlanFeature[];
};

interface PermissionFunctions {
  check(permission: GlobalPermission): boolean;
  check(permission: EnvScopedPermission, envs: string[]): boolean;
}

type User = { id: string; email: string; name: string };

export interface UserContextValue {
  userId?: string;
  name?: string;
  email?: string;
  admin?: boolean;
  role?: string;
  license?: LicenseData;
  users: Map<string, User>;
  getUserDisplay: (id: string, fallback?: boolean) => string;
  updateUser: () => Promise<void>;
  refreshOrganization: () => Promise<void>;
  permissions: Partial<Record<GlobalPermission, boolean>> & PermissionFunctions;
  settings: OrganizationSettings;
  enterpriseSSO?: SSOConnectionInterface;
  accountPlan?: AccountPlan;
  accountPlanFeatures: AccountPlanFeature[];
  apiKeys: ApiKeyInterface[];
  organization: Partial<OrganizationInterface & { members: MemberInfo[] }>;
  error?: string;
  hasPlanFeature: (feature: AccountPlanFeature) => boolean;
}

interface UserResponse {
  status: number;
  userId: string;
  userName: string;
  email: string;
  admin: boolean;
  organizations?: UserOrganizations;
  license?: LicenseData;
}

export const UserContext = createContext<UserContextValue>({
  permissions: { check: () => false },
  settings: {},
  users: new Map(),
  accountPlanFeatures: [],
  getUserDisplay: () => "",
  updateUser: async () => {
    // Do nothing
  },
  refreshOrganization: async () => {
    // Do nothing
  },
  apiKeys: [],
  organization: {},
  hasPlanFeature: () => false,
});

export function useUser() {
  return useContext(UserContext);
}

let currentUser: null | {
  id: string;
  org: string;
  role: MemberRole;
} = null;
export function getCurrentUser() {
  return currentUser;
}

export function UserContextProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, apiCall, orgId, setOrganizations } = useAuth();

  const [data, setData] = useState<null | UserResponse>(null);
  const [error, setError] = useState("");
  const [currentOrg, setCurrentOrg] = useState<null | OrgSettingsResponse>(
    null
  );
  const router = useRouter();

  const updateUser = useCallback(async () => {
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
  }, [apiCall, setOrganizations]);

  const users = useMemo(() => {
    const userMap = new Map<string, User>();
    const members = currentOrg?.organization?.members;
    if (!members) return userMap;
    members.forEach((user: MemberInfo) => {
      userMap.set(user.id, user);
    });
    return userMap;
  }, [currentOrg?.organization?.members]);

  const refreshOrganization = useCallback(async () => {
    try {
      const res = await apiCall<OrgSettingsResponse>("/organization", {
        method: "GET",
      });
      setCurrentOrg(res);
    } catch (e) {
      setCurrentOrg(null);
    }
  }, [apiCall]);

  const role = data?.admin ? "admin" : currentOrg?.role || "readonly";
  const permissions = new Set(currentOrg?.permissions || []);

  const permissionsObj: Partial<Record<Permission, boolean>> = {};
  permissions.forEach((p) => (permissionsObj[p] = true));

  // Update current user data for telemetry data
  useEffect(() => {
    currentUser = {
      org: orgId || "",
      id: data?.userId || "",
      role,
    };
  }, [orgId, data?.userId, role]);

  // Refresh organization data when switching orgs
  useEffect(() => {
    if (orgId) {
      refreshOrganization();
      track("Organization Loaded");
    }
  }, [orgId, refreshOrganization]);

  // Once authenticated, get userId, orgId from API
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    updateUser();
  }, [isAuthenticated, updateUser]);

  // Update growthbook tarageting attributes
  const growthbook = useGrowthBook();
  useEffect(() => {
    growthbook.setAttributes({
      id: data?.userId || "",
      name: data?.userName || "",
      admin: data?.admin || false,
      company: currentOrg?.organization?.name || "",
      userAgent: window.navigator.userAgent,
      url: router?.pathname || "",
      cloud: isCloud(),
      accountPlan: currentOrg?.accountPlan || "unknown",
      hasLicenseKey: !!data?.license,
      freeSeats: currentOrg?.organization?.freeSeats || 3,
      discountCode: currentOrg?.organization?.discountCode || "",
    });
  }, [data, currentOrg, router?.pathname, growthbook]);

  useEffect(() => {
    if (!data?.email) return;

    // Error tracking only enabled on GrowthBook Cloud
    if (isSentryEnabled()) {
      Sentry.setUser({ email: data.email, id: data.userId });
    }
  }, [data?.email, data?.userId]);

  const planFeatures = useMemo(() => {
    return new Set(currentOrg?.accountPlanFeatures || []);
  }, [currentOrg?.accountPlanFeatures]);

  return (
    <UserContext.Provider
      value={{
        userId: data?.userId,
        name: data?.userName,
        email: data?.email,
        admin: data?.admin,
        updateUser,
        users,
        getUserDisplay: (id, fallback = true) => {
          const u = users.get(id);
          if (!u && fallback) return id;
          return u?.name || u?.email;
        },
        refreshOrganization,
        role,
        permissions: {
          ...permissionsObj,
          check: (permission: Permission, envs?: string[]): boolean => {
            // If they have the global permission, then they are always allowed
            if (permissions.has(permission)) return true;
            // If it's an environment-scoped permission, they need permission for all environments
            if (envs?.length) {
              // If there are no environments where the user is missing permissions, return true
              return !envs.filter(
                (e) =>
                  !permissions.has(`${permission as EnvScopedPermission}.${e}`)
              ).length;
            }
            // No permissions by default
            return false;
          },
        },
        settings: currentOrg?.organization?.settings || {},
        license: data?.license,
        enterpriseSSO: currentOrg?.enterpriseSSO,
        accountPlan: currentOrg?.accountPlan,
        accountPlanFeatures: currentOrg?.accountPlanFeatures || [],
        apiKeys: currentOrg?.apiKeys || [],
        organization: currentOrg?.organization,
        error,
        hasPlanFeature: (feature) => planFeatures.has(feature),
      }}
    >
      {children}
    </UserContext.Provider>
  );
}
