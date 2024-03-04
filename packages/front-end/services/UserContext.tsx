import { useGrowthBook } from "@growthbook/growthbook-react";
import { ApiKeyInterface } from "back-end/types/apikey";
import { TeamInterface } from "back-end/types/team";
import {
  EnvScopedPermission,
  GlobalPermission,
  MemberRole,
  ExpandedMember,
  OrganizationInterface,
  OrganizationSettings,
  Permission,
  Role,
  ProjectScopedPermission,
  UserPermissions,
} from "back-end/types/organization";
import type {
  AccountPlan,
  CommercialFeature,
  LicenseInterface,
} from "enterprise";
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
import { GROWTHBOOK_SECURE_ATTRIBUTE_SALT } from "shared/constants";
import { userHasPermission } from "shared/permissions";
import { isCloud, isMultiOrg, isSentryEnabled } from "@/services/env";
import useApi from "@/hooks/useApi";
import { useAuth, UserOrganizations } from "@/services/auth";
import track from "@/services/track";
import { AppFeatures } from "@/types/app-features";
import { sha256 } from "@/services/utils";

type OrgSettingsResponse = {
  organization: OrganizationInterface;
  members: ExpandedMember[];
  roles: Role[];
  apiKeys: ApiKeyInterface[];
  enterpriseSSO: SSOConnectionInterface | null;
  accountPlan: AccountPlan;
  effectiveAccountPlan: AccountPlan;
  commercialFeatures: CommercialFeature[];
  license: LicenseInterface;
  licenseKey?: string;
  currentUserPermissions: UserPermissions;
  teams: TeamInterface[];
};

export interface PermissionFunctions {
  check(permission: GlobalPermission): boolean;
  check(
    permission: EnvScopedPermission,
    project: string[] | string | undefined,
    envs: string[]
  ): boolean;
  check(
    permission: ProjectScopedPermission,
    project: string[] | string | undefined
  ): boolean;
}

export type Team = Omit<TeamInterface, "members"> & {
  members?: ExpandedMember[];
};

export const DEFAULT_PERMISSIONS: Record<GlobalPermission, boolean> = {
  createDimensions: false,
  createPresentations: false,
  createSegments: false,
  manageApiKeys: false,
  manageBilling: false,
  manageNamespaces: false,
  manageNorthStarMetric: false,
  manageSavedGroups: false,
  manageArchetype: false,
  manageTags: false,
  manageTargetingAttributes: false,
  manageTeam: false,
  manageWebhooks: false,
  manageIntegrations: false,
  organizationSettings: false,
  superDelete: false,
  viewEvents: false,
  readData: false,
};

export interface UserContextValue {
  userId?: string;
  name?: string;
  email?: string;
  superAdmin?: boolean;
  license?: LicenseInterface;
  user?: ExpandedMember;
  users: Map<string, ExpandedMember>;
  getUserDisplay: (id: string, fallback?: boolean) => string;
  updateUser: () => Promise<void>;
  refreshOrganization: () => Promise<void>;
  permissions: Record<GlobalPermission, boolean> & PermissionFunctions;
  settings: OrganizationSettings;
  enterpriseSSO?: SSOConnectionInterface;
  accountPlan?: AccountPlan;
  effectiveAccountPlan?: AccountPlan;
  commercialFeatures: CommercialFeature[];
  apiKeys: ApiKeyInterface[];
  organization: Partial<OrganizationInterface>;
  roles: Role[];
  teams?: Team[];
  error?: string;
  hasCommercialFeature: (feature: CommercialFeature) => boolean;
}

interface UserResponse {
  status: number;
  userId: string;
  userName: string;
  email: string;
  verified: boolean;
  superAdmin: boolean;
  organizations?: UserOrganizations;
  currentUserPermissions: UserPermissions;
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
  teams: [],
  hasCommercialFeature: () => false,
});

export function useUser() {
  return useContext(UserContext);
}

let currentUser: null | {
  id: string;
  org: string;
  role: MemberRole | "";
} = null;
export function getCurrentUser() {
  return currentUser;
}

export function UserContextProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, apiCall, orgId, setOrganizations } = useAuth();

  const [data, setData] = useState<null | UserResponse>(null);
  const [error, setError] = useState("");
  const router = useRouter();

  const {
    data: currentOrg,
    mutate: refreshOrganization,
  } = useApi<OrgSettingsResponse>(isAuthenticated ? `/organization` : null);

  const [hashedOrganizationId, setHashedOrganizationId] = useState<string>("");
  useEffect(() => {
    const id = currentOrg?.organization?.id || "";
    sha256(GROWTHBOOK_SECURE_ATTRIBUTE_SALT + id).then((hashedOrgId) => {
      setHashedOrganizationId(hashedOrgId);
    });
  }, [currentOrg?.organization?.id]);

  const updateUser = useCallback(async () => {
    try {
      const res = await apiCall<UserResponse>("/user", {
        method: "GET",
      });
      setData(res);
      if (res.organizations && setOrganizations) {
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

  const teams = useMemo(() => {
    return currentOrg?.teams.map((team) => {
      const hydratedMembers = team.members?.reduce<ExpandedMember[]>(
        (res, member) => {
          const user = users.get(member);
          if (user) {
            res.push(user);
          }
          return res;
        },
        []
      );
      return { ...team, members: hydratedMembers };
    });
  }, [currentOrg?.teams, users]);

  let user = users.get(data?.userId || "");
  if (!user && data) {
    user = {
      email: data.email,
      verified: data.verified,
      id: data.userId,
      environments: [],
      limitAccessByEnvironment: false,
      name: data.userName,
      role: data.superAdmin ? "admin" : "readonly",
      projectRoles: [],
    };
  }

  const role =
    (data?.superAdmin && "admin") ||
    (user?.role ?? currentOrg?.organization?.settings?.defaultRole?.role);

  // Build out permissions object for backwards-compatible `permissions.manageTeams` style usage
  const permissionsObj: Record<GlobalPermission, boolean> = {
    ...DEFAULT_PERMISSIONS,
  };

  for (const permission in permissionsObj) {
    permissionsObj[permission] =
      currentOrg?.currentUserPermissions?.global.permissions[permission] ||
      false;
  }

  // Update current user data for telemetry data
  useEffect(() => {
    currentUser = {
      org: orgId || "",
      id: data?.userId || "",
      role: role || "",
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

  // Refresh org after loading license
  useEffect(() => {
    if (orgId) {
      void refreshOrganization();
    }
  }, [orgId, currentOrg?.organization?.licenseKey, refreshOrganization]);

  // Update growthbook tarageting attributes
  const growthbook = useGrowthBook<AppFeatures>();
  useEffect(() => {
    growthbook?.setAttributes({
      id: data?.userId || "",
      name: data?.userName || "",
      superAdmin: data?.superAdmin || false,
      company: currentOrg?.organization?.name || "",
      organizationId: hashedOrganizationId,
      userAgent: window.navigator.userAgent,
      url: router?.pathname || "",
      cloud: isCloud(),
      multiOrg: isMultiOrg(),
      accountPlan: currentOrg?.accountPlan || "unknown",
      hasLicenseKey: !!currentOrg?.organization?.licenseKey,
      freeSeats: currentOrg?.organization?.freeSeats || 3,
      discountCode: currentOrg?.organization?.discountCode || "",
    });
  }, [data, currentOrg, hashedOrganizationId, router?.pathname, growthbook]);

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
      project?: string[] | string,
      envs?: string[]
    ): boolean => {
      if (!currentOrg?.currentUserPermissions || !currentOrg || !data?.userId)
        return false;

      return userHasPermission(
        data.superAdmin || false,
        currentOrg.currentUserPermissions,
        permission,
        project,
        envs ? [...envs] : undefined
      );
    },
    [currentOrg, data?.superAdmin, data?.userId]
  );

  return (
    <UserContext.Provider
      value={{
        userId: data?.userId,
        name: data?.userName,
        email: data?.email,
        superAdmin: data?.superAdmin,
        updateUser,
        user,
        users,
        getUserDisplay: (id, fallback = true) => {
          const u = users.get(id);
          if (!u && fallback) return id;
          return u?.name || u?.email || "";
        },
        refreshOrganization: refreshOrganization as () => Promise<void>,
        roles: currentOrg?.roles || [],
        permissions: {
          ...permissionsObj,
          check: permissionsCheck,
        },
        settings: currentOrg?.organization?.settings || {},
        license: currentOrg?.license,
        enterpriseSSO: currentOrg?.enterpriseSSO || undefined,
        accountPlan: currentOrg?.accountPlan,
        effectiveAccountPlan: currentOrg?.effectiveAccountPlan,
        commercialFeatures: currentOrg?.commercialFeatures || [],
        apiKeys: currentOrg?.apiKeys || [],
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'OrganizationInterface | undefined' is not as... Remove this comment to see the full error message
        organization: currentOrg?.organization,
        teams,
        error,
        hasCommercialFeature: (feature) => commercialFeatures.has(feature),
      }}
    >
      {children}
    </UserContext.Provider>
  );
}
