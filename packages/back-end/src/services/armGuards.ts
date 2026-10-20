import { Revision } from "shared/enterprise";

// Guards that arm a deferred (scheduled / auto-publish-on-approval) publish with
// an acknowledgment fingerprint. Each stores its acknowledged conflict keys under
// its own id in the revision's `armAcknowledgments` map, so keys never collide
// across guards (e.g. the experiment guard and the config-lock guard can both
// name the same config key without conflating their acknowledgments).
export type ArmGuardId =
  | "experiment"
  | "config-lock"
  | "schema-break"
  | "archive-dependents";

// The per-guard arm-time acknowledgment fingerprint stored on a revision.
export type ArmAcknowledgments = Partial<Record<ArmGuardId, string[]>>;

// The acknowledged keys captured for one guard at arm time, if any.
export function getArmAcknowledgment(
  revision: Pick<Revision, "armAcknowledgments">,
  guard: ArmGuardId,
): string[] | null {
  return revision.armAcknowledgments?.[guard] ?? null;
}

// Whether a map carries any acknowledged keys at all (an all-empty map is treated
// as absent — nothing to compare a fire-time conflict against).
export function hasArmAcknowledgments(
  map: ArmAcknowledgments | null | undefined,
): boolean {
  return !!map && Object.values(map).some((keys) => (keys?.length ?? 0) > 0);
}

// Build the map to persist at arm time from each guard's captured keys, dropping
// guards with no keys. Returns undefined when nothing was acknowledged.
export function buildArmAcknowledgments(
  entries: Partial<Record<ArmGuardId, string[] | undefined>>,
): ArmAcknowledgments | undefined {
  const out: ArmAcknowledgments = {};
  for (const [guard, keys] of Object.entries(entries) as [
    ArmGuardId,
    string[] | undefined,
  ][]) {
    if (keys && keys.length) out[guard] = keys;
  }
  return hasArmAcknowledgments(out) ? out : undefined;
}
