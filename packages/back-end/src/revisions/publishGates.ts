// Aggregated publish-gate reporting for the REST revision-publish endpoints.
// A blocked publish returns ONE structured 422 naming every gate with a uniform
// set of fields (override flag, required permission, and a callable resolution
// route), so a caller discovers every way past every gate in a single round
// trip. On a SUCCESSFUL publish, any gate that WOULD have blocked but was
// bypassed is reported in `bypassedGates`, so an audit trail records what the
// caller's authority skipped. For the config and constant publish handlers the
// collected guard gates plus this evaluation ARE the enforcement; the
// approval/stale-base/value-validation asserts in the handlers remain as
// backstops behind their gates.
//
// Gates fall into two classes, distinguished by their `override` flag:
//  - ACKNOWLEDGE-class (`override: "ignoreWarnings"`): "heads up, this ripples"
//    warnings — experiment guard, stale-base, archive-dependents, custom-hook
//    warnings. Anyone can clear them with `ignoreWarnings` (and the bypass-
//    approval permission clears the soft ones on its own).
//  - VALIDATION-class (`override: "skipSchemaValidation"`): "your data/rules are
//    wrong" failures — own-schema errors, cross-field invariants, downstream
//    schema breaks, custom-hook rejections. Clearable ONLY by the privileged
//    `skipSchemaValidation` flag, which itself requires the bypassApprovalChecks
//    permission. `ignoreWarnings` and the org REST-bypass setting never clear
//    them, and they are kept OUT of the flattened `warnings` list so an
//    ignoreWarnings ack-and-retry never loops on a gate it can't clear.

// Two override kinds, one per gate class:
//  - "ignoreWarnings": acknowledge-class (experiment guard, stale-base,
//    archive-dependents, downstream soft warnings) — anyone can clear it.
//  - "skipSchemaValidation": validation-class (own-schema errors, cross-field
//    invariants, schema-break, custom-hook failures) — clearable ONLY by a
//    caller holding the bypassApprovalChecks permission.
export type PublishGateOverride = "ignoreWarnings" | "skipSchemaValidation";

/** The non-flag way past a gate, expressed as a callable REST route. */
export type PublishGateResolution = {
  /** Short verb naming the action, e.g. "unlock", "request-review", "rebase". */
  action: string;
  /** HTTP method to call the route with. */
  method: string;
  /** Route path (same relative form as the OpenAPI paths). */
  path: string;
};

export type PublishGate = {
  /** Stable identifier for the gate, e.g. "approval-required", "stale-base". */
  type: string;
  severity: "blocker" | "warning";
  /** Human-readable detail; the first entry is the gate's one-line summary. */
  messages: string[];
  /**
   * The request-body flag that clears this gate on a retry, or `null` when no
   * flag clears it (e.g. approval-required, which needs the revision approved
   * or a caller whose permission bypasses approval implicitly). Always present.
   */
  override: PublishGateOverride | null;
  /**
   * Permission the caller must hold for the override flag to take effect, or
   * `null` when the flag alone suffices. Always present.
   */
  requiresPermission: string | null;
  /**
   * The non-flag way out, as a callable route, or `null` when the override flag
   * is the only path. Always present.
   */
  resolution: PublishGateResolution | null;
};

export type PublishOverrideFlags = {
  ignoreWarnings?: boolean;
  skipSchemaValidation?: boolean;
};

/** A gate that would have blocked the publish but was bypassed by the caller. */
export type BypassedGate = {
  type: string;
  outcome: "bypassed";
  /**
   * The bypass source: an override flag ("ignoreWarnings" or the privileged
   * "skipSchemaValidation"), the caller's permission ("bypassApprovalChecks"),
   * or the org setting ("restApiBypassesReviews").
   */
  via: string;
};

/** Soft-guard (acknowledge-class) gate types: cleared by ignoreWarnings, or by
 * the bypass-approval permission alone. Schema-break is NOT here — it moved to
 * the validation class (override "skipSchemaValidation"). */
const SOFT_GUARD_GATE_TYPES: ReadonlySet<string> = new Set([
  "experiment-guard",
  "config-lock",
  "archive-dependents",
]);

/**
 * The clearing signals a request carries, used to decide each gate's
 * disposition. Handlers assemble this from their own bypass computations so the
 * gate evaluation matches the sequential backstops exactly.
 */
export type PublishGateClearance = {
  /** The request asked to force past warnings (body `ignoreWarnings`/`mergeNow`). */
  ignoreWarnings: boolean;
  /**
   * The caller may skip validation-class gates (schema errors, invariants,
   * schema-break, hook failures) — i.e. they passed `skipSchemaValidation` AND
   * hold the bypassApprovalChecks permission. Already resolves flag+permission
   * together (mirrors `context.skipSchemaValidation`), so a skipSchemaValidation
   * gate is bypassed iff this is true — the org REST-bypass setting never grants it.
   */
  skipSchemaValidation: boolean;
  /** The caller holds the bypassApprovalChecks permission on the entity's scope. */
  bypassApprovalPermission: boolean;
  /** The org's REST-bypass setting clears approval for this caller. */
  restApiBypassesReviews: boolean;
  /**
   * Whether the caller may force-merge a stale base — each handler's governance
   * bypass authority (permission, and for most entities the REST setting too;
   * features gate rebase on the permission alone).
   */
  canForceMergeStaleBase: boolean;
};

/**
 * The gates a request does NOT clear via a request-body flag: a gate is cleared
 * only when it has an override flag, that flag was passed, AND (when the gate
 * names a required permission) the caller holds that permission. A gate without
 * an override is never cleared here. Pure — the flag-clearing primitive shared
 * by the disposition logic and exported for unit tests.
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

export type PublishGateDisposition =
  | { outcome: "blocking" }
  | { outcome: "bypassed"; via: string };

/**
 * Decide whether a single active gate blocks the publish or is bypassed (and by
 * what). Pure — exported for unit tests. The flag path reuses `unclearedGates`
 * (so its requiresPermission handling stays the single source of truth); the
 * non-flag paths encode each gate kind's authority:
 *  - config-locked: never bypassed on publish (unlock is a separate action).
 *  - approval-required: bypassed by the bypass-approval permission or the org
 *    REST setting (labeled by which was the reason).
 *  - stale-base: bypassed only by ignoreWarnings + force-merge authority.
 *  - soft guards: bypassed by ignoreWarnings, or the bypass-approval permission.
 */
export function classifyPublishGate(
  gate: PublishGate,
  clearance: PublishGateClearance,
): PublishGateDisposition {
  // Validation-class gates clear ONLY on the privileged skipSchemaValidation
  // signal (which already folds in the bypassApprovalChecks permission).
  // Handled explicitly, ahead of the generic flag path, so neither ignoreWarnings
  // nor the org REST-bypass setting can clear a validation failure.
  if (gate.override === "skipSchemaValidation") {
    return clearance.skipSchemaValidation
      ? { outcome: "bypassed", via: "skipSchemaValidation" }
      : { outcome: "blocking" };
  }

  const flags: PublishOverrideFlags = {
    ignoreWarnings: clearance.ignoreWarnings,
  };
  const hasPermission = (permission: string) =>
    permission === "bypassApprovalChecks" && clearance.canForceMergeStaleBase;
  if (unclearedGates([gate], flags, hasPermission).length === 0) {
    // Only ignoreWarnings-override gates are flag-clearable here.
    return { outcome: "bypassed", via: "ignoreWarnings" };
  }

  if (gate.type === "config-locked") return { outcome: "blocking" };

  if (gate.type === "approval-required") {
    if (clearance.restApiBypassesReviews) {
      return { outcome: "bypassed", via: "restApiBypassesReviews" };
    }
    if (clearance.bypassApprovalPermission) {
      return { outcome: "bypassed", via: "bypassApprovalChecks" };
    }
    return { outcome: "blocking" };
  }

  if (SOFT_GUARD_GATE_TYPES.has(gate.type)) {
    if (clearance.bypassApprovalPermission) {
      return { outcome: "bypassed", via: "bypassApprovalChecks" };
    }
    return { outcome: "blocking" };
  }

  // stale-base (not flag-cleared) and any unrecognized gate: blocking.
  return { outcome: "blocking" };
}

/**
 * Partition every active gate into the set that still blocks the publish and the
 * set the caller's authority bypasses. Pure — the single entry the handlers use.
 */
export function evaluatePublishGates(
  gates: PublishGate[],
  clearance: PublishGateClearance,
): { blocking: PublishGate[]; bypassed: BypassedGate[] } {
  const blocking: PublishGate[] = [];
  const bypassed: BypassedGate[] = [];
  for (const gate of gates) {
    const disposition = classifyPublishGate(gate, clearance);
    if (disposition.outcome === "blocking") {
      blocking.push(gate);
    } else {
      bypassed.push({
        type: gate.type,
        outcome: "bypassed",
        via: disposition.via,
      });
    }
  }
  return { blocking, bypassed };
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
