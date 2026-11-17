// Specific files, not the package barrels: this module is imported by both apps
// and a barrel round-trip risks a runtime cycle.
import type { Permissions } from "./permissionsClass";

// Pure client-side predictions of ContextualBanditModel.canUpdate, so a control
// and its endpoint cannot disagree.

type PermissionsUtil = Pick<
  Permissions,
  "canUpdateContextualBandit" | "canRunContextualBandit"
>;

type ContextualBandit = { project?: string };

// Start, Stop and Archive-while-running all route through `update`, which
// demands the update atom on top of the run one. No empty-environments escape
// hatch, unlike canRunInterleavingControl: the bandit server calls
// canRunContextualBandit unconditionally.
//
// Permission only — `archived` is deliberately not consulted. The server
// never checks it to authorize, and an archived bandit can still be running
// and must still be stoppable; only Start rejects archived, so that term
// belongs at the Start call site.
export function canRunContextualBanditControl(
  permissionsUtil: PermissionsUtil,
  cb: ContextualBandit,
  environments: string[],
): boolean {
  return (
    permissionsUtil.canUpdateContextualBandit(cb, cb) &&
    permissionsUtil.canRunContextualBandit(cb, environments)
  );
}
