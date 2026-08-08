import { Policy, POLICY_PARTS } from "shared/permissions";

export type PolicyCheckboxState = boolean | "indeterminate";

function partsOf(policy: Policy): Policy[] {
  return POLICY_PARTS[policy] ?? [];
}

/**
 * Whether a policy is granted in full: the bundle itself, or every one of its
 * parts selected individually — which is how a role saved before the bundle
 * existed comes back.
 */
export function holdsWholePolicy(policy: Policy, policies: string[]): boolean {
  const parts = partsOf(policy);
  return (
    policies.includes(policy) ||
    (parts.length > 0 && parts.every((p) => policies.includes(p)))
  );
}

/** How the parent checkbox reads: whole → checked, some → indeterminate. */
export function policyCheckboxState(
  policy: Policy,
  policies: string[],
): PolicyCheckboxState {
  if (holdsWholePolicy(policy, policies)) return true;
  return partsOf(policy).some((p) => policies.includes(p))
    ? "indeterminate"
    : false;
}

/** Whether an individual permission is granted, by bundle or by its own entry. */
export function holdsPolicyPart(
  policy: Policy,
  part: Policy,
  policies: string[],
): boolean {
  return policies.includes(policy) || policies.includes(part);
}

/**
 * Clicking the parent: select the whole group, or clear it when it is already
 * whole. From indeterminate it fills in rather than discarding the picks the user
 * just made — the toggle a select-all is expected to be.
 */
export function togglePolicy(policy: Policy, policies: string[]): string[] {
  const parts = new Set<string>(partsOf(policy));
  const rest = policies.filter((p) => p !== policy && !parts.has(p));
  // The bundle grants everything its parts do, so it is stored alone.
  return holdsWholePolicy(policy, policies) ? rest : [...rest, policy];
}

/**
 * Clicking one permission ejects from the bundle: the whole-policy grant is
 * replaced by the individual parts it covered, plus or minus this one. Back at
 * every part, it collapses to the bundle again rather than storing them all.
 */
export function togglePolicyPart(
  policy: Policy,
  part: Policy,
  policies: string[],
): string[] {
  const parts = partsOf(policy);
  const bundled = policies.includes(policy);
  const explicit = new Set<Policy>(
    bundled ? parts : parts.filter((p) => policies.includes(p)),
  );
  if (explicit.has(part)) explicit.delete(part);
  else explicit.add(part);

  const partSet = new Set<string>(parts);
  const rest = policies.filter((p) => p !== policy && !partSet.has(p));
  return explicit.size === parts.length
    ? [...rest, policy]
    : [...rest, ...Array.from(explicit)];
}
