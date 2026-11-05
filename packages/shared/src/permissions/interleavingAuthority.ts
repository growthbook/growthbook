// Specific files, not the package barrels: this module is imported by both apps
// and a barrel round-trip risks a runtime cycle.
import type { Permissions } from "./permissionsClass";

// Pure client-side predictions of InterleavingModel.canUpdate, so a control and
// its endpoint cannot disagree.

type PermissionsUtil = Pick<
  Permissions,
  "canUpdateInterleaving" | "canRunInterleaving" | "canRunInterleavingUpdate"
>;

type Interleaving = { project?: string; archived: boolean };

// Start, Stop and Edit status all route through `update`, which demands the
// update atom on top of the run one.
export function canRunInterleavingControl(
  permissionsUtil: PermissionsUtil,
  interleaving: Interleaving,
  environments: string[],
): boolean {
  if (interleaving.archived) return false;
  if (!permissionsUtil.canUpdateInterleaving(interleaving, {})) return false;
  return (
    environments.length === 0 ||
    permissionsUtil.canRunInterleaving(interleaving, environments)
  );
}

// Vacuously true when nothing moves, so it is safe to call unconditionally.
export function holdsInterleavingMoveDestination(
  permissionsUtil: PermissionsUtil,
  interleaving: Interleaving & { serving: boolean },
  destination: string | undefined,
  environments: string[],
): boolean {
  const updated = { project: destination };
  if (!permissionsUtil.canUpdateInterleaving(interleaving, updated)) {
    return false;
  }
  if ((destination || "") === (interleaving.project || "")) return true;
  if (!interleaving.serving || environments.length === 0) return true;
  return permissionsUtil.canRunInterleavingUpdate(
    interleaving,
    updated,
    environments,
  );
}
