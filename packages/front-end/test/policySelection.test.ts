import { POLICY_PARTS, Policy } from "shared/permissions";
import {
  holdsPolicyPart,
  holdsWholePolicy,
  policyCheckboxState,
  togglePolicy,
  togglePolicyPart,
} from "@/components/Teams/Roles/policySelection";

const BUNDLES = (Object.keys(POLICY_PARTS) as Policy[]).filter(
  (p) => (POLICY_PARTS[p] || []).length > 0,
);

function subsets(parts: Policy[]): Policy[][] {
  return parts.reduce<Policy[][]>(
    (acc, part) => [...acc, ...acc.map((set) => [...set, part])],
    [[]],
  );
}

describe.each(BUNDLES)("%s", (policy) => {
  const parts = (POLICY_PARTS[policy] || []) as Policy[];
  const allSubsets = subsets(parts);

  it("reads checked exactly when it is granted in full", () => {
    for (const selected of allSubsets) {
      const whole = selected.length === parts.length;
      expect(policyCheckboxState(policy, selected)).toBe(
        whole ? true : selected.length > 0 ? "indeterminate" : false,
      );
    }
    expect(policyCheckboxState(policy, [policy])).toBe(true);
  });

  // Checkbox state and its next transition must agree.
  it("clicking a checked box clears the group, from every state that reads checked", () => {
    const checkedStates = [[policy], parts, ...allSubsets].filter(
      (selected) => policyCheckboxState(policy, selected) === true,
    );
    expect(checkedStates.length).toBeGreaterThan(1);
    for (const selected of checkedStates) {
      const next = togglePolicy(policy, selected);
      expect(policyCheckboxState(policy, next)).toBe(false);
      expect(next).not.toContain(policy);
      for (const part of parts) expect(next).not.toContain(part);
    }
  });

  it("clicking an unchecked or indeterminate box grants the whole group", () => {
    const fillStates = allSubsets.filter(
      (selected) => policyCheckboxState(policy, selected) !== true,
    );
    for (const selected of fillStates) {
      const next = togglePolicy(policy, selected);
      expect(holdsWholePolicy(policy, next)).toBe(true);
      for (const part of parts) {
        expect(holdsPolicyPart(policy, part, next)).toBe(true);
      }
    }
  });

  it("settles on all-or-nothing and never returns to indeterminate", () => {
    for (const selected of [[policy], parts, ...allSubsets]) {
      const wasWhole = policyCheckboxState(policy, selected) === true;
      const once = togglePolicy(policy, selected);
      expect(policyCheckboxState(policy, once)).toBe(!wasWhole);
      const twice = togglePolicy(policy, once);
      expect(policyCheckboxState(policy, twice)).toBe(wasWhole);
    }
  });

  it("toggling one permission changes only that permission", () => {
    for (const selected of allSubsets) {
      for (const part of parts) {
        const next = togglePolicyPart(policy, part, selected);
        expect(holdsPolicyPart(policy, part, next)).toBe(
          !holdsPolicyPart(policy, part, selected),
        );
        for (const other of parts.filter((p) => p !== part)) {
          expect(holdsPolicyPart(policy, other, next)).toBe(
            holdsPolicyPart(policy, other, selected),
          );
        }
      }
    }
  });

  it("collapses to the bundle when every permission ends up selected", () => {
    if (parts.length < 2) return;
    const allButOne = parts.slice(0, -1);
    const next = togglePolicyPart(policy, parts[parts.length - 1], allButOne);
    expect(next).toContain(policy);
    for (const part of parts) expect(next).not.toContain(part);
  });

  it("ejects the bundle into explicit permissions when one is removed", () => {
    const next = togglePolicyPart(policy, parts[0], [policy]);
    expect(next).not.toContain(policy);
    expect(holdsPolicyPart(policy, parts[0], next)).toBe(false);
    for (const other of parts.slice(1)) {
      expect(holdsPolicyPart(policy, other, next)).toBe(true);
    }
  });

  it("never stores a bundle alongside its own parts", () => {
    const states = [[policy], parts, ...allSubsets];
    for (const selected of states) {
      for (const candidate of [
        togglePolicy(policy, selected),
        ...parts.map((part) => togglePolicyPart(policy, part, selected)),
      ]) {
        if (candidate.includes(policy)) {
          for (const part of parts) expect(candidate).not.toContain(part);
        }
      }
    }
  });

  it("leaves unrelated policies untouched", () => {
    const unrelated = "UnrelatedPolicy";
    for (const selected of allSubsets) {
      expect(togglePolicy(policy, [...selected, unrelated])).toContain(
        unrelated,
      );
      for (const part of parts) {
        expect(
          togglePolicyPart(policy, part, [...selected, unrelated]),
        ).toContain(unrelated);
      }
    }
  });
});
