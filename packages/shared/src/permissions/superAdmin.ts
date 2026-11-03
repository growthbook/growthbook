import {
  SUPER_ADMIN_PERMISSIONS,
  SuperAdmin,
  SuperAdminPermission,
} from "../validators/users";

function isSuperAdminPermission(p: unknown): p is SuperAdminPermission {
  return SUPER_ADMIN_PERMISSIONS.includes(p as SuperAdminPermission);
}

// Takes the raw stored value, so anything other than `true` or an array of
// known permissions (a missing field, a malformed Mongo edit) grants nothing.
export function hasSuperAdminPermission(
  superAdmin: SuperAdmin | null | undefined,
  permission: SuperAdminPermission,
): boolean {
  if (superAdmin === true) return true;
  if (!Array.isArray(superAdmin)) return false;
  if (superAdmin.includes(permission)) return true;
  // Every other permission is useless without seeing the admin page
  return permission === "view" && superAdmin.some(isSuperAdminPermission);
}

// Whether `actor` holds every permission `target` has. Only a full super admin
// covers another full super admin.
export function holdsAllSuperAdminPermissions(
  actor: SuperAdmin | null | undefined,
  target: SuperAdmin | null | undefined,
): boolean {
  if (actor === true) return true;
  if (target === true) return false;
  if (!Array.isArray(target)) return true;
  return target.every(
    (p) => isSuperAdminPermission(p) && hasSuperAdminPermission(actor, p),
  );
}

// Granting is capped by what the granter holds, before and after, so `grant`
// can never escalate or strip a more privileged admin.
export function canChangeSuperAdmin(
  actor: SuperAdmin | null | undefined,
  before: SuperAdmin | null | undefined,
  after: SuperAdmin | null | undefined,
): boolean {
  return (
    hasSuperAdminPermission(actor, "grant") &&
    holdsAllSuperAdminPermissions(actor, before) &&
    holdsAllSuperAdminPermissions(actor, after)
  );
}

// Canonical stored form: `true`, `false`, or a sorted, de-duplicated non-empty list
export function normalizeSuperAdmin(
  superAdmin: SuperAdmin | null | undefined,
): SuperAdmin {
  if (superAdmin === true) return true;
  if (!Array.isArray(superAdmin)) return false;
  const perms = SUPER_ADMIN_PERMISSIONS.filter((p) => superAdmin.includes(p));
  return perms.length ? perms : false;
}
