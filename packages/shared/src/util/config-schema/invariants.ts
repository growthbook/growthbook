import { apply, truthy } from "json-logic-js";
import { z } from "zod";
import { configInvariantValidator } from "../../validators/features";

export type ConfigInvariant = z.infer<typeof configInvariantValidator>;
export type InvariantViolation = { name: string; message: string };

// Evaluate a config's cross-field invariants against its resolved (inherited+own)
// value. Each invariant's `rule` is a JSONLogic boolean expression; a missing
// field reads as null (json-logic-js `var` semantics), so rules must tolerate
// nulls (e.g. `field != null`). Returns one entry per rule that isn't satisfied.
// A malformed rule is surfaced as a violation rather than throwing, so it can
// never crash the save path.
export function evaluateInvariants(
  value: Record<string, unknown>,
  invariants?: ConfigInvariant[] | null,
): InvariantViolation[] {
  if (!invariants?.length) return [];
  const violations: InvariantViolation[] = [];
  for (const inv of invariants) {
    let satisfied: boolean;
    try {
      const rule = JSON.parse(inv.rule) as Parameters<typeof apply>[0];
      satisfied = truthy(apply(rule, value));
    } catch {
      // Unparseable or malformed rule → surface as a violation, never throw.
      violations.push({ name: inv.name, message: inv.message });
      continue;
    }
    if (!satisfied) violations.push({ name: inv.name, message: inv.message });
  }
  return violations;
}
