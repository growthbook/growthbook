import { Policy, POLICY_PARTS } from "shared/permissions";

export type PolicyCheckboxState = boolean | "indeterminate";

function partsOf(policy: Policy): Policy[] {
  return POLICY_PARTS[policy] ?? [];
}

// Treat legacy roles with every part selected as holding the whole policy.
export function holdsWholePolicy(policy: Policy, policies: string[]): boolean {
  const parts = partsOf(policy);
  return (
    policies.includes(policy) ||
    (parts.length > 0 && parts.every((p) => policies.includes(p)))
  );
}

export function policyCheckboxState(
  policy: Policy,
  policies: string[],
): PolicyCheckboxState {
  if (holdsWholePolicy(policy, policies)) return true;
  return partsOf(policy).some((p) => policies.includes(p))
    ? "indeterminate"
    : false;
}

export function holdsPolicyPart(
  policy: Policy,
  part: Policy,
  policies: string[],
): boolean {
  return policies.includes(policy) || policies.includes(part);
}

// Selecting the parent replaces its individual parts with the bundle.
export function togglePolicy(policy: Policy, policies: string[]): string[] {
  const parts = new Set<string>(partsOf(policy));
  const rest = policies.filter((p) => p !== policy && !parts.has(p));
  return holdsWholePolicy(policy, policies) ? rest : [...rest, policy];
}

// Editing a part expands the bundle, then collapses it again when all parts remain.
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
