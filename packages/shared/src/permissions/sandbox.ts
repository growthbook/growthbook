import type {
  OrganizationInterface,
  Permission,
  SandboxKind,
  UserPermission,
  UserPermissions,
} from "shared/types/organization";

export type SandboxPolicy = {
  deniedPermissions: readonly Permission[];
  lifetimeDays: number;
};

// What each kind of sandbox may not do while it is active. The workspace only
// records its kind, so a new kind of sandbox is a new entry here.
export const SANDBOX_POLICIES: Record<SandboxKind, SandboxPolicy> = {
  "agent-signup": {
    deniedPermissions: [
      "runExperiments",
      "createDatasources",
      "editDatasourceSettings",
      "manageSDKWebhooks",
      "manageEventWebhooks",
      "manageIntegrations",
    ],
    lifetimeDays: 7,
  },
};

export function getActiveSandboxPolicy(
  org: Pick<OrganizationInterface, "sandbox">,
): SandboxPolicy | null {
  const sandbox = org.sandbox;
  if (!sandbox || sandbox.status !== "active") return null;
  return SANDBOX_POLICIES[sandbox.kind] ?? null;
}

export function isActiveSandbox(
  org: Pick<OrganizationInterface, "sandbox">,
): boolean {
  return getActiveSandboxPolicy(org) !== null;
}

function removeFromUserPermission(
  p: UserPermission,
  denied: ReadonlySet<Permission>,
): UserPermission {
  const permissions = { ...p.permissions };
  for (const d of denied) delete permissions[d];
  return {
    ...p,
    permissions,
    ...(p.envGrants
      ? {
          envGrants: p.envGrants.map((g) => ({
            ...g,
            permissions: g.permissions.filter((x) => !denied.has(x)),
          })),
        }
      : {}),
  };
}

// A copy with the denied permissions gone from the global role, every project
// role and every environment grant, so no path back to them remains.
export function removePermissions(
  permissions: UserPermissions,
  denied: readonly Permission[],
): UserPermissions {
  const set = new Set(denied);
  return {
    global: removeFromUserPermission(permissions.global, set),
    projects: Object.fromEntries(
      Object.entries(permissions.projects).map(([id, p]) => [
        id,
        removeFromUserPermission(p, set),
      ]),
    ),
  };
}

export const SANDBOX_LINK_PATH = "/link";

export function sandboxRefusalHint(appOrigin: string): string {
  return `This workspace is a sandbox. Link it at ${appOrigin}${SANDBOX_LINK_PATH} to run experiments and connect data.`;
}
