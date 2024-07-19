import { useGrowthBook } from "@growthbook/growthbook-react";
import { ApiKeyInterface } from "back-end/types/apikey";
import { TeamInterface } from "back-end/types/team";
import {
  EnvScopedPermission,
  GlobalPermission,
  ExpandedMember,
  OrganizationInterface,
  OrganizationSettings,
  Role,
  ProjectScopedPermission,
  UserPermissions,
  SubscriptionQuote,
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
import { Permissions, getDefaultRole } from "shared/permissions";
import { isCloud, isMultiOrg, isSentryEnabled } from "@/services/env";
import useApi from "@/hooks/useApi";
import { useAuth, UserOrganizations } from "@/services/auth";
import track from "@/services/track";
import { AppFeatures } from "@/types/app-features";
import { sha256 } from "@/services/utils";

type OrgSettingsResponse = {
  organization: OrganizationInterface;
  members: ExpandedMember[];
  seatsInUse: number;
  roles: Role[];
  apiKeys: ApiKeyInterface[];
  enterpriseSSO: SSOConnectionInterface | null;
  accountPlan: AccountPlan;
  effectiveAccountPlan: AccountPlan;
  licenseError: string;
  commercialFeatures: CommercialFeature[];
  license: LicenseInterface;
  licenseKey?: string;
  currentUserPermissions: UserPermissions;
  teams: TeamInterface[];
  watching: {
    experiments: string[];
    features: string[];
  };
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
  manageTeam: false,
  manageEventWebhooks: false,
  manageIntegrations: false,
  organizationSettings: false,
  superDeleteReport: false,
  viewAuditLog: false,
  readData: false,
  manageCustomRoles: false,
};

export interface UserContextValue {
  ready?: boolean;
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
  settings: OrganizationSettings;
  enterpriseSSO?: SSOConnectionInterface;
  accountPlan?: AccountPlan;
  effectiveAccountPlan?: AccountPlan;
  licenseError: string;
  commercialFeatures: CommercialFeature[];
  apiKeys: ApiKeyInterface[];
  organization: Partial<OrganizationInterface>;
  seatsInUse: number;
  roles: Role[];
  teams?: Team[];
  error?: string;
  hasCommercialFeature: (feature: CommercialFeature) => boolean;
  permissionsUtil: Permissions;
  quote: SubscriptionQuote | null;
  watching: {
    experiments: string[];
    features: string[];
  };
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
  licenseError: "",
  seatsInUse: 0,
  teams: [],
  hasCommercialFeature: () => false,
  permissionsUtil: new Permissions(
    {
      global: {
        permissions: {},
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    },
    false
  ),
  quote: null,
  watching: {
    experiments: [],
    features: [],
  },
});

export function useUser() {
  return useContext(UserContext);
}

let currentUser: null | {
  id: string;
  org: string;
  role: string;
} = null;
export function getCurrentUser() {
  return currentUser;
}

export function UserContextProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, orgId, setOrganizations } = useAuth();

  const { data, mutate: mutateUser, error } = useApi<UserResponse>(`/user`, {
    shouldRun: () => isAuthenticated,
    orgScoped: false,
  });

  const updateUser = useCallback(async () => {
    await mutateUser();
  }, [mutateUser]);

  const router = useRouter();

  const {
    data: currentOrg,
    mutate: refreshOrganization,
    error: orgLoadingError,
  } = useApi<OrgSettingsResponse>(`/organization`, {
    shouldRun: () => !!orgId,
  });

  const [hashedOrganizationId, setHashedOrganizationId] = useState<string>("");
  useEffect(() => {
    const id = currentOrg?.organization?.id || "";
    sha256(GROWTHBOOK_SECURE_ATTRIBUTE_SALT + id).then((hashedOrgId) => {
      setHashedOrganizationId(hashedOrgId);
    });
  }, [currentOrg?.organization?.id]);

  useEffect(() => {
    if (data?.organizations && setOrganizations) {
      setOrganizations(data.organizations);
    }
  }, [data, setOrganizations]);

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
    (user?.role ?? getDefaultRole(currentOrg?.organization || {}).role);

  // Update current user data for telemetry data
  useEffect(() => {
    currentUser = {
      org: orgId || "",
      id: data?.userId || "",
      role: role || "",
    };
  }, [orgId, data?.userId, role]);

  useEffect(() => {
    if (orgId && data?.userId) {
      track("Organization Loaded");
    }
  }, [orgId, data?.userId]);

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

  const permissionsUtil = useMemo(() => {
    return new Permissions(
      currentOrg?.currentUserPermissions || {
        global: {
          permissions: {},
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      data?.superAdmin || false
    );
  }, [currentOrg?.currentUserPermissions, data?.superAdmin]);

  const getUserDisplay = useCallback(
    (id: string, fallback = true) => {
      const u = users.get(id);
      if (!u && fallback) return id;
      return u?.name || u?.email || "";
    },
    [users]
  );

  // Get a quote for upgrading
  const { data: quoteData, mutate: mutateQuote } = useApi<{
    quote: SubscriptionQuote;
  }>(`/subscription/quote`, {
    shouldRun: () =>
      !!currentOrg?.organization &&
      isAuthenticated &&
      !!orgId &&
      permissionsUtil.canManageBilling(),
    autoRevalidate: false,
  });
  const freeSeats = currentOrg?.organization?.freeSeats || 3;
  useEffect(() => {
    mutateQuote();
  }, [freeSeats, mutateQuote]);

  const quote = quoteData?.quote || null;

  const watching = useMemo(() => {
    return {
      experiments: currentOrg?.watching?.experiments || [],
      features: currentOrg?.watching?.features || [],
    };
  }, [currentOrg]);

  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (data) setReady(true);
  }, [data]);

  return (
    <UserContext.Provider
      value={{
        ready: ready,
        userId: data?.userId,
        name: data?.userName,
        email: data?.email,
        superAdmin: data?.superAdmin,
        updateUser,
        user,
        users,
        getUserDisplay: getUserDisplay,
        refreshOrganization: refreshOrganization as () => Promise<void>,
        roles: currentOrg?.roles || [],
        permissionsUtil,
        settings: currentOrg?.organization?.settings || {},
        license: currentOrg?.license,
        enterpriseSSO: currentOrg?.enterpriseSSO || undefined,
        accountPlan: currentOrg?.accountPlan,
        effectiveAccountPlan: currentOrg?.effectiveAccountPlan,
        licenseError: currentOrg?.licenseError || "",
        commercialFeatures: currentOrg?.commercialFeatures || [],
        apiKeys: currentOrg?.apiKeys || [],
        organization: currentOrg?.organization || {},
        seatsInUse: currentOrg?.seatsInUse || 0,
        teams,
        error: error?.message || orgLoadingError?.message,
        hasCommercialFeature: (feature) => commercialFeatures.has(feature),
        quote: quote,
        watching: watching,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}
