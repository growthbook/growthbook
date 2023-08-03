import { useGrowthBook } from "@growthbook/growthbook-react";
import { ApiKeyInterface } from "back-end/types/apikey";
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
} from "back-end/types/organization";
import type { AccountPlan, CommercialFeature, LicenseData } from "enterprise";
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
import { isCloud, isSentryEnabled } from "@/services/env";
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
  verified: boolean;
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

export function getRolesByTeam(teamId: string, user: any) {
  // const teamPermissions = getTeamById(teamId); // This is on the backend, not the frontend - Do I need to make this an API call?
  return {
    ...user,
    role: "admin",
  };
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
      if (res.organizations) {
        // @ts-expect-error TS(2722) If you come across this, please fix it!: Cannot invoke an object which is possibly 'undefin... Remove this comment to see the full error message
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

  // console.log("data", data);

  // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
  let user = users.get(data?.userId);
  if (!user && data) {
    user = {
      email: data.email,
      verified: data.verified,
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
  // console.log("permissionsObj", permissionsObj);
  // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'MemberRole | undefined' is not a... Remove this comment to see the full error message
  getPermissionsByRole(role, currentOrg?.roles || []).forEach((p) => {
    permissionsObj[p] = true;
  });

  // Update current user data for telemetry data
  useEffect(() => {
    currentUser = {
      org: orgId || "",
      id: data?.userId || "",
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'MemberRole | undefined' is not assignable to... Remove this comment to see the full error message
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
  const growthbook = useGrowthBook<AppFeatures>();
  useEffect(() => {
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    growthbook.setAttributes({
      id: data?.userId || "",
      name: data?.userName || "",
      admin: data?.admin || false,
      company: currentOrg?.organization?.name || "",
      organizationId: hashedOrganizationId,
      userAgent: window.navigator.userAgent,
      url: router?.pathname || "",
      cloud: isCloud(),
      accountPlan: currentOrg?.accountPlan || "unknown",
      hasLicenseKey: !!data?.license,
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

  const newPermissionsCheck = useCallback(
    (
      permission: Permission,
      project?: string | undefined,
      envs?: string[]
    ): boolean => {
      console.log("user in newPermissionsCheck", user);
      console.log("checking permission: ", permission);
      console.log("project: ", project);
      console.log("envs: ", envs);

      // So, this will take in a permission, along with an optional project & an optional environment array
      // We need to see if the permission passed in, is permitted by user.permissions
      const permissions = user?.permissionsUpdated[permission];
      console.log("permissions", permissions);

      // Check to see if the user's role gives them global permission for this action
      if (permissions.globalPermissions.hasPermission) {
        // If no envs are passed in, just return true;
        if (!envs) {
          return true;
          // If envs are passed in, first check if this permission is limited by environment, if not, return true,
          // Otherwise, look to see if the env passed in is included in the globalPermissions environments arary. If so, return true, otherwise, return false.
        } else {
          if (!permissions.globalPermissions.limitAccessByEnvironment) {
            return true;
          } else if (
            permissions.globalPermissions.environments.some((e) =>
              envs.includes(e)
            )
          ) {
            return true;
          }
        }
      }

      // If a project was passed in, and the global permission was false, we need to check the project's permission
      if (project) {
        console.log(
          "project was passed in & global permission was false, need to check current project's permissions"
        );
        const projectLevelPermissions = permissions.projectPermissions.find(
          (p) => p.projectId === project
        );

        console.log("projectLevelPermissions", projectLevelPermissions);

        if (!projectLevelPermissions) {
          return false;
        }

        if (projectLevelPermissions.hasPermission) {
          // If no envs are passed in, just return true;
          if (!envs) {
            return true;
          } else {
            // If envs are passed in, first check if this permission is limited by environment, if not, return true,
            // Otherwise, look to see if the env passed in is included in the globalPermissions environments arary. If so, return true, otherwise, return false.
            if (!projectLevelPermissions.limitAccessByEnvironment) {
              return true;
            } else if (
              projectLevelPermissions.environments.some((e) => envs.includes(e))
            ) {
              return true;
            }
          }
        }
      }
      return false;
    },
    [user]
  );

  const permissionsCheck = useCallback(
    (
      permission: Permission,
      project?: string | undefined,
      envs?: string[]
    ): boolean => {
      console.log("checking permission");
      // console.log("permission", permission);
      // console.log("project", project);
      // console.log("envs", envs);
      // TODO: Add logic here to handle the case where a user is on a team
      // Get the role based on the project (if specified)
      // Fall back to the user's global role
      // console.log("currentOrg", currentOrg);
      const projectRoles: any = []; //TODO: Type this array
      let hasPermission = false;

      console.log("user", user);

      // If this user's permissions are controlled by a team, we need to get the permissions from all teams the user is on
      if (user?.teams && user?.teams.length > 0) {
        console.log(
          "user is on atleast 1 team, we need to handle them differently"
        );
        user.teams.forEach((team) => {
          // -> This needs to get the permissions based on the team, and merge it with the user to return an object similar to the "user" object
          const teamPermissions = getRolesByTeam(team, user);
          console.log("teamPermissions", teamPermissions);
          projectRoles.push(teamPermissions);
          // projectRoles.push(
          //   (project &&
          //     teamPermissions.projectRoles?.find(
          //       (r) => r.project === project
          //     )) ||
          //     teamPermissions
          // ); f
        });
      } else {
        console.log("no user team");
        projectRoles.push(
          (project && user?.projectRoles?.find((r) => r.project === project)) ||
            user
        );
      }

      // Missing role entirely, deny access
      if (!projectRoles.length) {
        return false;
      }

      console.log("projectRole", projectRoles);

      projectRoles.forEach((projectRole: any) => {
        // If hasPermission has been set to true, we don't need to check any more roles
        if (hasPermission) return;
        // Admin role always has permission
        if (projectRole.role === "admin") hasPermission = true;

        const permissions = getPermissionsByRole(
          projectRole.role,
          currentOrg?.roles || []
        );

        // Missing permission
        if (permissions.has(permission)) {
          hasPermission = true;
        }

        // If it's an environment-scoped permission and the user's role has limited access
        if (envs && projectRole.limitAccessByEnvironment) {
          for (let i = 0; i < envs.length; i++) {
            if (projectRole.environments.includes(envs[i])) {
              hasPermission = true;
            }
          }
        }
      });

      // If it got through all the above checks, the user has permission
      console.log("hasPermission", hasPermission);
      return hasPermission;
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
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '(id: string, fallback?: boolean | undefined)... Remove this comment to see the full error message
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
          // check: permissionsCheck,
          check: newPermissionsCheck,
        },
        settings: currentOrg?.organization?.settings || {},
        license: data?.license,
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'SSOConnectionInterface | null | undefined' i... Remove this comment to see the full error message
        enterpriseSSO: currentOrg?.enterpriseSSO,
        accountPlan: currentOrg?.accountPlan,
        commercialFeatures: currentOrg?.commercialFeatures || [],
        apiKeys: currentOrg?.apiKeys || [],
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'OrganizationInterface | undefined' is not as... Remove this comment to see the full error message
        organization: currentOrg?.organization,
        error,
        hasCommercialFeature: (feature) => commercialFeatures.has(feature),
      }}
    >
      {children}
    </UserContext.Provider>
  );
}
