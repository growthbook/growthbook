import { UserPermissions } from "shared/types/organization";

/**
 * Legacy permission keys, re-derived from the atoms that replaced them.
 *
 * During a rolling deployment an OLDER front-end talks to this back-end and reads
 * `manageFeatures`/`manageSavedGroups`/etc. from the bootstrap response. Those keys
 * no longer exist, and a missing key reads as `false` — so every write control
 * disappeared for the duration of the rollout, admins included.
 *
 * Emitted at the RESPONSE boundary only: authority decisions run on the new atoms,
 * and nothing in this codebase reads these back. They exist purely so an old client
 * keeps working until it is replaced.
 */
export function withLegacyPermissionAliases(
  permissions: UserPermissions,
): UserPermissions {
  const alias = (p: Record<string, boolean | undefined>) => {
    const manageFeatures = !!(
      p.createFeatures ||
      p.editFeatureDrafts ||
      p.publishFeatures
    );
    return {
      ...p,
      ...(manageFeatures ? { manageFeatures: true } : {}),
      ...(p.createSavedGroups || p.editSavedGroupDrafts || p.publishSavedGroups
        ? { manageSavedGroups: true }
        : {}),
      ...(p.createConfigs || p.editConfigDrafts || p.publishConfigs
        ? { manageConfigs: true }
        : {}),
      ...(p.createConstants || p.editConstantDrafts || p.publishConstants
        ? { manageConstants: true }
        : {}),
    };
  };

  return {
    global: {
      ...permissions.global,
      permissions: alias(
        permissions.global.permissions as Record<string, boolean | undefined>,
      ),
    },
    projects: Object.fromEntries(
      Object.entries(permissions.projects).map(([project, scope]) => [
        project,
        {
          ...scope,
          permissions: alias(
            scope.permissions as Record<string, boolean | undefined>,
          ),
        },
      ]),
    ) as UserPermissions["projects"],
  } as UserPermissions;
}
