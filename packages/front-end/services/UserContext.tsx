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
  ProjectScopedPermission,
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
import * as Sentry from "@sentry/react";
import { isCloud, isSentryEnabled } from "@/services/env";
import useApi from "@/hooks/useApi";
import { useAuth, UserOrganizations } from "@/services/auth";
import track from "@/services/track";

type OrgSettingsResponse = {
  organization: OrganizationInterface;
  members: ExpandedMember[];
  roles: Role[];
  apiKeys: ApiKeyInterface[];
  enterpriseSSO: SSOConnectionInterface | null;
  accountPlan: AccountPlan;
  commercialFeatures: CommercialFeature[];
  licenseKey?: string;
};

export interface PermissionFunctions {
  check(permission: GlobalPermission): boolean;
  check(
    permission: EnvScopedPermission,
    project: string | undefined,
    envs: string[]
  ): boolean;
  check(
    permission: ProjectScopedPermission,
    project: string | undefined
  ): boolean;
}

export const DEFAULT_PERMISSIONS: Record<GlobalPermission, boolean> = {
  createDimensions: false,
  createPresentations: false,
  createSegments: false,
  manageApiKeys: false,
  manageBilling: false,
  manageNamespaces: false,
  manageNorthStarMetric: false,
  manageProjects: false,
  manageSavedGroups: false,
  manageTags: false,
  manageTargetingAttributes: false,
  manageTeam: false,
  manageWebhooks: false,
  manageIntegrations: false,
  organizationSettings: false,
  superDelete: false,
  viewEvents: false,
};

export interface UserContextValue {
  userId?: string;
  name?: string;
  email?: string;
  admin?: boolean;
  license?: LicenseData;
  user?: ExpandedMember;
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

export function getPermissionsByRole(
  role: MemberRole,
  roles: Role[]
): Set<Permission> {
  return new Set<Permission>(
    roles.find((r) => r.id === role)?.permissions || []
  );
}

export function UserContextProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, apiCall, orgId, setOrganizations } = useAuth();

  const [data, setData] = useState<null | UserResponse>(null);
  const [error, setError] = useState("");
  const router = useRouter();

  const {
    data: currentOrg,
    mutate: refreshOrganization,
  } = useApi<OrgSettingsResponse>(`/organization`);

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

  let user = users.get(data?.userId);
  if (!user && data) {
    user = {
      email: data.email,
      id: data.userId,
      environments: [],
      limitAccessByEnvironment: false,
      name: data.userName,
      role: data.admin ? "admin" : "readonly",
      projectRoles: [],
    };
  }
  const role =
    (data?.admin && "admin") ||
    (user?.role ?? currentOrg?.organization?.settings?.defaultRole?.role);

  // Build out permissions object for backwards-compatible `permissions.manageTeams` style usage
  const permissionsObj: Record<GlobalPermission, boolean> = {
    ...DEFAULT_PERMISSIONS,
  };
  getPermissionsByRole(role, currentOrg?.roles || []).forEach((p) => {
    permissionsObj[p] = true;
  });

  // Update current user data for telemetry data
  useEffect(() => {
    currentUser = {
      org: orgId || "",
      id: data?.userId || "",
      role: role,
    };
  }, [orgId, data?.userId, role]);

  // Refresh organization data when switching orgs
  useEffect(() => {
    if (orgId) {
      void refreshOrganization();
      track("Organization Loaded");
    }
  }, [orgId, refreshOrganization]);

  // Once authenticated, get userId, orgId from API
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    void updateUser();
  }, [isAuthenticated, updateUser]);

  // Refresh user and org after loading license
  useEffect(() => {
    if (orgId) {
      void refreshOrganization();
    }
    if (isAuthenticated) {
      void updateUser();
    }
  }, [
    orgId,
    isAuthenticated,
    currentOrg?.organization?.licenseKey,
    refreshOrganization,
    updateUser,
  ]);

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

  const permissionsCheck = useCallback(
    (
      permission: Permission,
      project?: string | undefined,
      envs?: string[]
    ): boolean => {
      // Get the role based on the project (if specified)
      // Fall back to the user's global role
      const projectRole =
        (project && user?.projectRoles?.find((r) => r.project === project)) ||
        user;

      // Missing role entirely, deny access
      if (!projectRole) {
        return false;
      }

      // Admin role always has permission
      if (projectRole.role === "admin") return true;

      const permissions = getPermissionsByRole(
        projectRole.role,
        currentOrg?.roles || []
      );

      // Missing permission
      if (!permissions.has(permission)) {
        return false;
      }

      // If it's an environment-scoped permission and the user's role has limited access
      if (envs && projectRole.limitAccessByEnvironment) {
        for (let i = 0; i < envs.length; i++) {
          if (!projectRole.environments.includes(envs[i])) {
            return false;
          }
        }
      }

      // If it got through all the above checks, the user has permission
      return true;
    },
    [currentOrg?.roles, user]
  );

  return (
    <UserContext.Provider
      value={{
        userId: data?.userId,
        name: data?.userName,
        email: data?.email,
        admin: data?.admin,
        updateUser,
        user,
        users,
        getUserDisplay: (id, fallback = true) => {
          const u = users.get(id);
          if (!u && fallback) return id;
          return u?.name || u?.email;
        },
        refreshOrganization: async () => {
          await refreshOrganization();
        },
        roles: currentOrg?.roles || [],
        permissions: {
          ...permissionsObj,
          check: permissionsCheck,
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
