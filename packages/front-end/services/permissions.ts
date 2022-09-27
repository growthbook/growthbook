import { EnvPermission, Permission } from "back-end/types/permissions";

export function checkEnvPermissions(
  permissions: Record<Permission, boolean>,
  envBasePermission: EnvPermission,
  ...environments: string[]
): boolean {
  if (permissions[envBasePermission]) return true;
  for (let i = 0; i < environments.length; i++) {
    if (!permissions[`${envBasePermission}_${environments[i]}`]) {
      return false;
    }
  }
  return true;
}
