import type { Context } from "back-end/src/models/BaseModel";

// Aggregated publish-gate reporting for the REST revision-publish endpoints.
// The sequential asserts in the handlers/adapters remain the enforcement layer;
// this module is the aggregation/UX layer that lets a blocked publish return
// ONE structured 422 naming every gate and the body flag that clears it, so a
// caller discovers all required override flags in a single round trip.

export type PublishGateOverride =
  | "bypassApproval"
  | "ignoreWarnings"
  | "skipSchemaValidation";

export type PublishGate = {
  /** Stable identifier for the gate, e.g. "approval-required", "stale-base". */
  type: string;
  severity: "blocker" | "warning";
  /** Human-readable detail; the first entry is the gate's one-line summary. */
  messages: string[];
  /** The request-body flag that clears this gate on a retry. */
  override: PublishGateOverride;
  /** Permission the caller must hold for the override flag to take effect. */
  requiresPermission?: string;
};

export type PublishOverrideFlags = {
  bypassApproval?: boolean;
  ignoreWarnings?: boolean;
  skipSchemaValidation?: boolean;
};

/**
 * The gates a request does NOT clear: a gate is cleared only when its override
 * flag was passed AND (when the gate names a required permission) the caller
 * holds that permission. Pure — exported for unit tests.
 */
export function unclearedGates(
  gates: PublishGate[],
  flags: PublishOverrideFlags,
  hasPermission: (permission: string) => boolean,
): PublishGate[] {
  return gates.filter((gate) => {
    if (flags[gate.override] !== true) return true;
    if (gate.requiresPermission && !hasPermission(gate.requiresPermission)) {
      return true;
    }
    return false;
  });
}

function formatGateLine(gate: PublishGate): string {
  const permissionNote = gate.requiresPermission
    ? `, requires the ${gate.requiresPermission} permission`
    : "";
  return `- [${gate.type}] ${gate.messages[0] ?? ""} (retry with "${gate.override}": true${permissionNote})`;
}

export class PublishBlockedError extends Error {
  status = 422;
  gates: PublishGate[];
  // Flattened gate messages, mirroring SoftWarningError's `warnings` so
  // existing "save anyway" retry flows keep working against this error too.
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
    this.warnings = gates.flatMap((gate) => gate.messages);
  }
}

/**
 * Throw a PublishBlockedError (422) listing every gate the request's override
 * flags don't clear. Callers assemble gates only for conditions that would
 * actually block them (a caller whose authority implicitly bypasses a check
 * gets no gate for it), so the permission lookup here is a conservative
 * backstop for the flag-plus-permission overrides.
 */
export async function assertPublishGates(
  context: Context,
  gates: PublishGate[],
  flags: PublishOverrideFlags,
): Promise<void> {
  if (!gates.length) return;
  const remaining = unclearedGates(gates, flags, (permission) => {
    if (permission === "bypassApprovalChecks") {
      return context.permissions.canBypassApprovalChecks({ project: "" });
    }
    return false;
  });
  if (remaining.length) {
    throw new PublishBlockedError(remaining);
  }
}
