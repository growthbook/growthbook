import { ApiKeyInterface } from "back-end/types/apikey";
import { TeamInterface } from "back-end/types/team";
import {
  EnvScopedPermission,
  GlobalPermission,
  ExpandedMember,
  OrganizationInterface,
  OrganizationSettings,
  Permission,
  Role,
  ProjectScopedPermission,
  UserPermissions,
  GetOrganizationResponse,
  OrganizationUsage,
} from "back-end/types/organization";
import type {
  AccountPlan,
  CommercialFeature,
  LicenseInterface,
  SubscriptionInfo,
} from "shared/enterprise";
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
import * as Sentry from "@sentry/nextjs";
import { GROWTHBOOK_SECURE_ATTRIBUTE_SALT } from "shared/constants";
import { Permissions, userHasPermission } from "shared/permissions";
import { getValidDate } from "shared/dates";
import sha256 from "crypto-js/sha256";
import { useFeature } from "@growthbook/growthbook-react";
import { AgreementType } from "back-end/src/validators/agreements";
import {
  getGrowthBookBuild,
  getSuperadminDefaultRole,
  hasFileConfig,
  isCloud,
  isMultiOrg,
  isSentryEnabled,
  usingSSO,
} from "@/services/env";
import useApi from "@/hooks/useApi";
import { useAuth, UserOrganizations } from "@/services/auth";
import { getJitsuClient, trackPageView } from "@/services/track";
import { getOrGeneratePageId, growthbook } from "@/services/utils";

export interface PermissionFunctions {
  check(permission: GlobalPermission): boolean;
  check(
    permission: EnvScopedPermission,
    project: string[] | string | undefined,
    envs: string[],
  ): boolean;
  check(
    permission: ProjectScopedPermission,
    project: string[] | string | undefined,
  ): boolean;
}

export type Team = Omit<TeamInterface, "members"> & {
  members?: ExpandedMember[];
};

export const DEFAULT_PERMISSIONS: Record<GlobalPermission, boolean> = {
  createDimensions: false,
  createPresentations: false,
  createMetricGroups: false,
  manageApiKeys: false,
  manageBilling: false,
  manageNamespaces: false,
  manageNorthStarMetric: false,
  manageTags: false,
  manageTeam: false,
  manageEventWebhooks: false,
  manageIntegrations: false,
  organizationSettings: false,
  superDeleteReport: false,
  viewAuditLog: false,
  readData: false,
  manageCustomRoles: false,
  manageCustomFields: false,
  manageDecisionCriteria: false,
};

export interface UserContextValue {
  ready?: boolean;
  userId?: string;
  name?: string;
  pylonHmacHash?: string;
  email?: string;
  superAdmin?: boolean;
  license?: Partial<LicenseInterface> | null;
  installationName?: string;
  subscription: SubscriptionInfo | null;
  user?: ExpandedMember;
  users: Map<string, ExpandedMember>;
  getUserDisplay: (id: string, fallback?: boolean) => string;
  updateUser: () => Promise<void>;
  refreshOrganization: () => Promise<void>;
  permissions: Record<GlobalPermission, boolean> & PermissionFunctions;
  settings: OrganizationSettings;
  enterpriseSSO?: Partial<SSOConnectionInterface> | null;
  accountPlan?: AccountPlan;
  effectiveAccountPlan?: AccountPlan;
  licenseError: string;
  commercialFeatures: CommercialFeature[];
  apiKeys: ApiKeyInterface[];
  organization: Partial<OrganizationInterface>;
  agreements?: AgreementType[];
  seatsInUse: number;
  roles: Role[];
  teams?: Team[];
  error?: string;
  hasCommercialFeature: (feature: CommercialFeature) => boolean;
  commercialFeatureLowestPlan?: Partial<Record<CommercialFeature, AccountPlan>>;
  permissionsUtil: Permissions;
  watching: {
    experiments: string[];
    features: string[];
  };
  canSubscribe: boolean;
  freeSeats: number;
  usage?: OrganizationUsage;
}

interface UserResponse {
  status: number;
  userId: string;
  userName: string;
  email: string;
  pylonHmacHash: string;
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
  agreements: [],
  subscription: null,
  licenseError: "",
  seatsInUse: 0,
  teams: [],
  hasCommercialFeature: () => false,
  permissionsUtil: new Permissions({
    global: {
      permissions: {},
      limitAccessByEnvironment: false,
      environments: [],
    },
    projects: {},
  }),
  watching: {
    experiments: [],
    features: [],
  },
  canSubscribe: false,
  freeSeats: 3,
});

export function useUser() {
  return useContext(UserContext);
}

let currentUser: null | {
  id: string;
  org: string;
  role: string;
  effectiveAccountPlan: string;
  orgCreationDate: string;
} = null;
export function getCurrentUser() {
  return currentUser;
}

export function UserContextProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, orgId, setOrganizations } = useAuth();

  const selfServePricingEnabled = useFeature("self-serve-billing").on;

  const {
    data,
    mutate: mutateUser,
    error,
  } = useApi<UserResponse>(`/user`, {
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
  } = useApi<GetOrganizationResponse>(`/organization`, {
    shouldRun: () => !!orgId,
  });

  const hashedOrganizationId = useMemo(() => {
    const id = currentOrg?.organization?.id || "";
    if (!id) return "";
    return sha256(GROWTHBOOK_SECURE_ATTRIBUTE_SALT + id).toString();
  }, [currentOrg?.organization?.id]);

  useEffect(() => {
    if (data?.organizations && setOrganizations) {
      setOrganizations(data.organizations, data.superAdmin);
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
        [],
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
      role: data.superAdmin ? getSuperadminDefaultRole() : "readonly",
      projectRoles: [],
    };
  }

  // Update current user data for telemetry data
  useEffect(() => {
    currentUser = {
      org: orgId || "",
      id: data?.userId || "",
      role: user?.role || "",
      effectiveAccountPlan: currentOrg?.effectiveAccountPlan ?? "",
      orgCreationDate: currentOrg?.organization?.dateCreated
        ? getValidDate(currentOrg.organization.dateCreated).toISOString()
        : "",
    };
  }, [
    orgId,
    currentOrg?.effectiveAccountPlan,
    currentOrg?.organization,
    data?.userId,
    user?.role,
  ]);

  // User/build GrowthBook attributes
  useEffect(() => {
    let anonymous_id = "";
    // This is an undocumented way to get the anonymous id from Jitsu
    // Lots of type guards added to avoid breaking if we update Jitsu in the future
    const jitsu = getJitsuClient();
    if (
      jitsu &&
      "getAnonymousId" in jitsu &&
      typeof jitsu.getAnonymousId === "function"
    ) {
      const _anonymous_id = jitsu.getAnonymousId();
      if (typeof _anonymous_id === "string") {
        anonymous_id = _anonymous_id;
      }
    }

    const build = getGrowthBookBuild();

    growthbook.updateAttributes({
      anonymous_id,
      id: data?.userId || "",
      user_id: data?.userId || "",
      superAdmin: data?.superAdmin || false,
      cloud: isCloud(),
      multiOrg: isMultiOrg(),
      configFile: hasFileConfig(),
      usingSSO: usingSSO(),
      buildSHA: build.sha,
      buildDate: build.date,
      buildVersion: build.lastVersion,
      orgOwnerJobTitle:
        currentOrg?.organization?.demographicData?.ownerJobTitle,
      orgOwnerUsageIntents:
        currentOrg?.organization?.demographicData?.ownerUsageIntents,
    });
  }, [
    data?.superAdmin,
    data?.userId,
    currentOrg?.organization?.demographicData?.ownerJobTitle,
    currentOrg?.organization?.demographicData?.ownerUsageIntents,
  ]);

  // Org GrowthBook attributes
  useEffect(() => {
    growthbook.updateAttributes({
      role: user?.role || "",
      organizationId: hashedOrganizationId,
      cloudOrgId: isCloud() ? currentOrg?.organization?.id || "" : "",
      orgDateCreated: currentOrg?.organization?.dateCreated
        ? getValidDate(currentOrg.organization.dateCreated).toISOString()
        : "",
      accountPlan: currentOrg?.effectiveAccountPlan || "loading",
      hasLicenseKey: !!currentOrg?.organization?.licenseKey,
      freeSeats: currentOrg?.organization?.freeSeats || 3,
      discountCode: currentOrg?.organization?.discountCode || "",
      isVercelIntegration: !!currentOrg?.organization?.isVercelIntegration,
    });
  }, [currentOrg, hashedOrganizationId, user?.role]);

  // Page GrowthBook attributes
  useEffect(() => {
    growthbook.setURL(window.location.href);
    growthbook.updateAttributes({
      url: router?.pathname || "",
      page_id: getOrGeneratePageId(),
    });
  }, [router?.pathname]);

  // Track logged-in page views
  useEffect(() => {
    if (!currentOrg?.organization?.id) return;
    trackPageView(router.pathname);
  }, [router?.pathname, currentOrg?.organization?.id]);

  useEffect(() => {
    if (!data?.email) return;

    // Error tracking only enabled on GrowthBook Cloud
    if (isSentryEnabled()) {
      Sentry.setUser({ email: data.email, id: data.userId });
    }
  }, [data?.email, data?.userId]);

  useEffect(() => {
    // Error tracking only enabled on GrowthBook Cloud
    const orgId = currentOrg?.organization?.id;
    if (isSentryEnabled() && orgId) {
      Sentry.setTag("organization", orgId);
    }
  }, [currentOrg?.organization?.id]);

  const commercialFeatures = useMemo(() => {
    return new Set(currentOrg?.commercialFeatures || []);
  }, [currentOrg?.commercialFeatures]);

  const permissionsCheck = useCallback(
    (
      permission: Permission,
      project?: string[] | string,
      envs?: string[],
    ): boolean => {
      if (!currentOrg?.currentUserPermissions || !currentOrg || !data?.userId)
        return false;

      return userHasPermission(
        currentOrg.currentUserPermissions,
        permission,
        project,
        envs ? [...envs] : undefined,
      );
    },
    [currentOrg, data?.userId],
  );

  const permissions = useMemo(() => {
    // Build out permissions object for backwards-compatible `permissions.manageTeams` style usage
    const permissions: Record<GlobalPermission, boolean> = {
      ...DEFAULT_PERMISSIONS,
    };

    for (const permission in permissions) {
      permissions[permission] =
        currentOrg?.currentUserPermissions?.global.permissions[permission] ||
        false;
    }

    return {
      ...permissions,
      check: permissionsCheck,
    };
  }, [
    currentOrg?.currentUserPermissions?.global.permissions,
    permissionsCheck,
  ]);

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
    );
  }, [currentOrg?.currentUserPermissions]);

  const getUserDisplay = useCallback(
    (id: string, fallback = true) => {
      const u = users.get(id);
      if (!u && fallback) return id;
      return u?.name || u?.email || "";
    },
    [users],
  );

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

  const organization: Partial<OrganizationInterface> | undefined =
    currentOrg?.organization;
  const subscription = currentOrg?.subscription || null;
  const license = currentOrg?.license;

  const canSubscribe = useMemo(() => {
    const disableSelfServeBilling =
      organization?.disableSelfServeBilling || false;

    if (disableSelfServeBilling) return false;

    if (organization?.enterprise) return false; //TODO: Remove this once we have moved the license off the organization

    if (license?.plan === "enterprise") return false;

    // if already on pro, they must have a subscription - some self-hosted pro have an annual contract not directly through stripe.
    if (
      license &&
      ["pro", "pro_sso"].includes(license.plan || "") &&
      !subscription?.externalId
    )
      return false;

    if (!selfServePricingEnabled) return false;

    if (["active", "trialing", "past_due"].includes(subscription?.status || ""))
      return false;

    return true;
  }, [organization, license, subscription, selfServePricingEnabled]);

  return (
    <UserContext.Provider
      value={{
        ready: ready,
        userId: data?.userId,
        name: data?.userName,
        email: data?.email,
        pylonHmacHash: data?.pylonHmacHash,
        superAdmin: data?.superAdmin,
        updateUser,
        user,
        users,
        getUserDisplay: getUserDisplay,
        refreshOrganization: refreshOrganization as () => Promise<void>,
        roles: currentOrg?.roles || [],
        permissions,
        permissionsUtil,
        settings: currentOrg?.organization?.settings || {},
        license,
        installationName: currentOrg?.installationName || undefined,
        subscription,
        enterpriseSSO: currentOrg?.enterpriseSSO || undefined,
        accountPlan: currentOrg?.accountPlan,
        effectiveAccountPlan: currentOrg?.effectiveAccountPlan,
        commercialFeatureLowestPlan: currentOrg?.commercialFeatureLowestPlan,
        licenseError: currentOrg?.licenseError || "",
        commercialFeatures: currentOrg?.commercialFeatures || [],
        agreements: currentOrg?.agreements || [],
        apiKeys: currentOrg?.apiKeys || [],
        organization: organization || {},
        seatsInUse: currentOrg?.seatsInUse || 0,
        teams,
        error: error?.message || orgLoadingError?.message,
        hasCommercialFeature: (feature) => commercialFeatures.has(feature),
        watching: watching,
        canSubscribe,
        freeSeats: organization?.freeSeats || 3,
        usage: currentOrg?.usage,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}
