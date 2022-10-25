import { useGrowthBook } from "@growthbook/growthbook-react";
import { ApiKeyInterface } from "back-end/types/apikey";
import {
  AccountPlan,
  CommercialFeature,
  EnvScopedPermission,
  GlobalPermission,
  LicenseData,
  MemberRole,
  ExpandedMember,
  OrganizationInterface,
  OrganizationSettings,
  Permission,
  Role,
  MemberRoleInfo,
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
import { useAuth, UserOrganizations } from "./auth";
import { isCloud, isSentryEnabled } from "./env";
import track from "./track";
import * as Sentry from "@sentry/react";

type OrgSettingsResponse = {
  organization: OrganizationInterface;
  members: ExpandedMember[];
  roles: Role[];
  apiKeys: ApiKeyInterface[];
  enterpriseSSO: SSOConnectionInterface | null;
  role: MemberRoleInfo;
  permissions: Permission[];
  accountPlan: AccountPlan;
  commercialFeatures: CommercialFeature[];
};

interface PermissionFunctions {
  check(permission: GlobalPermission): boolean;
  check(permission: EnvScopedPermission, envs: string[]): boolean;
}

export const DEFAULT_PERMISSIONS: Record<GlobalPermission, boolean> = {
  addComments: false,
  createAnalyses: false,
  createDatasources: false,
  createDimensions: false,
  createFeatureDrafts: false,
  createIdeas: false,
  createMetrics: false,
  createPresentations: false,
  createSegments: false,
  editDatasourceSettings: false,
  manageApiKeys: false,
  manageBilling: false,
  manageEnvironments: false,
  manageFeatures: false,
  manageNamespaces: false,
  manageNorthStarMetric: false,
  manageProjects: false,
  manageSavedGroups: false,
  manageTags: false,
  manageTargetingAttributes: false,
  manageTeam: false,
  manageWebhooks: false,
  organizationSettings: false,
  runQueries: false,
  superDelete: false,
};

export interface UserContextValue {
  userId?: string;
  name?: string;
  email?: string;
  admin?: boolean;
  role?: MemberRoleInfo;
  license?: LicenseData;
  users: Map<string, ExpandedMember>;
  getUserDisplay: (id: string, fallback?: boolean) => string;
  updateUser: () => Promise<void>;
  refreshOrganization: () => Promise<void>;
  permissions: Record<GlobalPermission, boolean> & PermissionFunctions;
  settings: OrganizationSettings;
  enterpriseSSO?: SSOConnectionInterface;
  accountPlan?: AccountPlan;
  commercialFeatures: CommercialFeature[];
  apiKeys: ApiKeyInterface[];
  organization: Partial<OrganizationInterface>;
  roles: Role[];
  error?: string;
  hasCommercialFeature: (feature: CommercialFeature) => boolean;
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
  permissions: { ...DEFAULT_PERMISSIONS, check: () => false },
  settings: {},
  users: new Map(),
  roles: [],
  commercialFeatures: [],
  getUserDisplay: () => "",
  updateUser: async () => {
    // Do nothing
  },
  refreshOrganization: async () => {
    // Do nothing
  },
  apiKeys: [],
  organization: {},
  hasCommercialFeature: () => false,
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
    const userMap = new Map<string, ExpandedMember>();
    const members = currentOrg?.members;
    if (!members) return userMap;
    members.forEach((member) => {
      userMap.set(member.id, member);
    });
    return userMap;
  }, [currentOrg?.members]);

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

  const role: MemberRoleInfo = useMemo(() => {
    if (data?.admin) {
      return {
        role: "admin",
        environments: [],
        limitAccessByEnvironment: false,
      };
    }

    return (
      currentOrg?.role || {
        role: "collaborator",
        environments: [],
        limitAccessByEnvironment: false,
      }
    );
  }, [data?.admin, currentOrg?.role]);
  const permissions = new Set(currentOrg?.permissions || []);

  const permissionsObj: Record<GlobalPermission, boolean> = {
    ...DEFAULT_PERMISSIONS,
  };
  permissions.forEach((p) => (permissionsObj[p] = true));

  // Update current user data for telemetry data
  useEffect(() => {
    currentUser = {
      org: orgId || "",
      id: data?.userId || "",
      role: role?.role,
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

  const commercialFeatures = useMemo(() => {
    return new Set(currentOrg?.commercialFeatures || []);
  }, [currentOrg?.commercialFeatures]);

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
        roles: currentOrg?.roles || [],
        permissions: {
          ...permissionsObj,
          check: (permission: Permission, envs?: string[]): boolean => {
            // Missing permission entirely
            if (!role || !permissions.has(permission)) {
              return false;
            }

            // Admin role always has permission
            if (role.role === "admin") return true;

            // If it's an environment-scoped permission and the user's role has limited access
            if (envs && role.limitAccessByEnvironment) {
              for (let i = 0; i < envs.length; i++) {
                if (!role.environments.includes(envs[i])) {
                  return false;
                }
              }
            }

            return true;
          },
        },
        settings: currentOrg?.organization?.settings || {},
        license: data?.license,
        enterpriseSSO: currentOrg?.enterpriseSSO,
        accountPlan: currentOrg?.accountPlan,
        commercialFeatures: currentOrg?.commercialFeatures || [],
        apiKeys: currentOrg?.apiKeys || [],
        organization: currentOrg?.organization,
        error,
        hasCommercialFeature: (feature) => commercialFeatures.has(feature),
      }}
    >
      {children}
    </UserContext.Provider>
  );
}
