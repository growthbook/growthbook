// Aggregated publish-gate reporting for the REST revision-publish endpoints.
// A blocked publish returns ONE structured 422 naming every gate and (when one
// exists) the body flag that clears it, so a caller discovers all required
// override flags in a single round trip. For the config and constant publish
// handlers the collected guard gates plus assertPublishGates ARE the
// enforcement; the approval/stale-base/value-validation asserts in the
// handlers remain as backstops behind their gates.

export type PublishGateOverride = "ignoreWarnings" | "skipSchemaValidation";

export type PublishGate = {
  /** Stable identifier for the gate, e.g. "approval-required", "stale-base". */
  type: string;
  severity: "blocker" | "warning";
  /** Human-readable detail; the first entry is the gate's one-line summary. */
  messages: string[];
  /**
   * The request-body flag that clears this gate on a retry. Absent when no
   * flag clears it (e.g. approval-required, which needs the revision approved
   * or a caller whose permission bypasses approval implicitly).
   */
  override?: PublishGateOverride;
  /** Permission the caller must hold for the override flag to take effect. */
  requiresPermission?: string;
};

export type PublishOverrideFlags = {
  ignoreWarnings?: boolean;
  skipSchemaValidation?: boolean;
};

/**
 * The gates a request does NOT clear: a gate is cleared only when it has an
 * override flag, that flag was passed, AND (when the gate names a required
 * permission) the caller holds that permission. A gate without an override is
 * never cleared here. Pure — exported for unit tests.
 */
export function unclearedGates(
  gates: PublishGate[],
  flags: PublishOverrideFlags,
  hasPermission: (permission: string) => boolean,
): PublishGate[] {
  return gates.filter((gate) => {
    if (!gate.override) return true;
    if (flags[gate.override] !== true) return true;
    if (gate.requiresPermission && !hasPermission(gate.requiresPermission)) {
      return true;
    }
    return false;
  });
}

function formatGateLine(gate: PublishGate): string {
  const summary = gate.messages[0] ?? "";
  if (!gate.override) return `- [${gate.type}] ${summary}`;
  const permissionNote = gate.requiresPermission
    ? `, requires the ${gate.requiresPermission} permission`
    : "";
  return `- [${gate.type}] ${summary} (retry with "${gate.override}": true${permissionNote})`;
}

export class PublishBlockedError extends Error {
  status = 422;
  gates: PublishGate[];
  // Flattened messages of the gates that `ignoreWarnings` clears, mirroring
  // SoftWarningError's `warnings` so existing ack-and-retry flows only see
  // warnings an ignoreWarnings retry can actually acknowledge. `gates` keeps
  // every gate, clearable or not.
  warnings: string[];

  constructor(gates: PublishGate[]) {
    super(
      [
        `Publish blocked by ${gates.length} gate(s):`,
        ...gates.map(formatGateLine),
      ].join("\n"),
    );
    this.name = "PublishBlockedError";
    this.gates = gates;
    this.warnings = gates
      .filter((gate) => gate.override === "ignoreWarnings")
      .flatMap((gate) => gate.messages);
  }
}

/**
 * Throw a PublishBlockedError (422) listing every gate the request's override
 * flags don't clear. Callers assemble gates only for conditions that would
 * actually block them (a caller whose authority implicitly bypasses a check
 * gets no gate for it) and pass `hasPermission` bound to the target entity's
 * project scope, so a flag-plus-permission override is honored exactly where
 * the equivalent assert would honor it.
 */
export function assertPublishGates(
  gates: PublishGate[],
  flags: PublishOverrideFlags,
  hasPermission: (permission: string) => boolean,
): void {
  if (!gates.length) return;
  const remaining = unclearedGates(gates, flags, hasPermission);
  if (remaining.length) {
    throw new PublishBlockedError(remaining);
  }
}
