import { isBypassApprovalPermission } from "shared/permissions";
import type { Permission } from "shared/types/organization";
import {
  canUseRestApiBypassSetting,
  type ReviewBypassRequest,
} from "back-end/src/api/features/reviewBypass";
import { getErrorMessage } from "back-end/src/util/errors";

// Publish-gate reporting for the REST revision-publish endpoints. A blocked
// publish returns one 422 naming every gate with its override flag, required
// permission and resolution route, so a caller learns every way past in one round
// trip; a successful publish reports whatever its authority skipped in
// `bypassedGates`.
//
// Two classes, by `override`:
//  - ACKNOWLEDGE (`ignoreWarnings`): this ripples — experiment guard, stale base,
//    archive dependents, hook warnings. Anyone may clear them.
//  - VALIDATION (`skipSchemaValidation`): the data is wrong — schema errors,
//    cross-field invariants, downstream breaks, hook rejections. Clearable only by
//    that privileged flag, never by `ignoreWarnings` or the org REST-bypass
//    setting, and kept out of `warnings` so an ack-and-retry cannot loop on a gate
//    it can't clear.

// Override kinds, one per gate class:
//  - "ignoreWarnings": acknowledge-class (experiment guard, stale-base,
//    archive-dependents, hook warnings) — anyone can clear it.
//  - "skipSchemaValidation": schema-validation-class (own-schema errors,
//    cross-field invariants, schema-break) — clearable ONLY by a caller holding
//    the entity's bypass-approval permission.
//  - "skipHooks": custom validation-hook rejections — also bypass-approval only,
//    but its own flag (a hook failure isn't a schema error).
export type PublishGateOverride =
  | "ignoreWarnings"
  | "skipSchemaValidation"
  | "skipHooks";

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
  skipHooks?: boolean;
};

// The override class for a schema-family failure (JSON-schema conformance,
// field-rule/invariant, or downstream schema break), honoring the org's "block
// publishing on JSON schema errors" setting: strict (default) makes it
// validation-class (privileged `skipSchemaValidation`); warn mode demotes it to
// acknowledge-class (`ignoreWarnings`, anyone). Custom-hook failures are NOT
// schema errors and never use this — a hook `throw` stays validation-class
// regardless of the setting.
export function schemaFailureGateOverride(
  blockOnSchemaError: boolean,
  // The entity family's bypass-approval atom — named by the caller, since this
  // helper is shared and the atom is per-family.
  bypassPermission: Permission,
): Pick<PublishGate, "override" | "requiresPermission"> {
  return blockOnSchemaError
    ? {
        override: "skipSchemaValidation",
        requiresPermission: bypassPermission,
      }
    : { override: "ignoreWarnings", requiresPermission: null };
}

/**
 * The single factory for a blocking gate — the {severity:"blocker", ...} shape
 * with all five always-present fields, so a PublishGate shape change touches
 * one place and a per-site override/permission/resolution slip can't happen.
 */
export function makeBlockingGate(args: {
  type: string;
  messages: string[];
  override?: PublishGateOverride | null;
  requiresPermission?: string | null;
  resolution?: PublishGateResolution | null;
}): PublishGate {
  return {
    type: args.type,
    severity: "blocker",
    messages: args.messages,
    override: args.override ?? null,
    requiresPermission: args.requiresPermission ?? null,
    resolution: args.resolution ?? null,
  };
}

// Convert a thrown error into a plan gate ONLY when it's a 4xx-class
// application rejection; rethrow infra/5xx (or non-status) errors so a
// transient failure surfaces as the 5xx it is instead of a permanent,
// unfixable gate. Shared by every plan-gate collector that wraps a
// DB-touching validation call. Generic in the gate type so callers that build
// a tagged gate (the orchestrator's itemGate) keep their concrete type.
export function gateOr5xx<G extends PublishGate>(
  e: unknown,
  makeGate: (message: string) => G,
): G {
  const status = (e as { status?: number }).status;
  if (typeof status !== "number" || status >= 500) throw e;
  return makeGate(getErrorMessage(e));
}

/** A gate that would have blocked the publish but was bypassed by the caller. */
// The closed set of bypass sources a response may report. Kept as a union (rather
// than the bare `string` the field is typed as) so a handler cannot invent a value
// the API docs don't describe.
export type BypassVia =
  | "ignoreWarnings"
  | "skipSchemaValidation"
  | "skipHooks"
  | "bypassApprovalPermission"
  | "restApiBypassesReviews"
  // The org's "reverts bypass approval" setting. Reverts are the one landing path
  // an org setting alone can clear, so it needs its own source.
  | "revertsBypassApproval";

export type BypassedGate = {
  type: string;
  outcome: "bypassed";
  // The bypass source: an override flag ("ignoreWarnings" or the privileged
  // "skipSchemaValidation"), the caller's bypass-approval permission for the
  // entity ("bypassApprovalPermission"), or an org setting
  // ("restApiBypassesReviews", "revertsBypassApproval").
  via: string;
};

/** Soft-guard (acknowledge-class) gate types: cleared by ignoreWarnings, or by
 * the bypass-approval permission alone (a "heads up, this ripples" warning an
 * approver can wave through). Schema-family gates are deliberately NOT here: in
 * block mode they carry override "skipSchemaValidation" (privileged) and in warn
 * mode override "ignoreWarnings" cleared only by an explicit ack — matching the
 * documented warn-mode contract and the assertConfigValueValidForPublish backstop,
 * neither of which grants a permission-alone escape for invalid data. */
const SOFT_GUARD_GATE_TYPES: ReadonlySet<string> = new Set([
  "experiment-guard",
  "dependent-config-locked",
  "archive-dependents",
]);

/** Feature lockdown gates, auto-cleared by the same authorities as
 * bypassLockdown on the single-entity path (bypass-approval permission or the
 * org REST-bypass setting) — no override flag required. */
const LOCKDOWN_GATE_TYPES: ReadonlySet<string> = new Set([
  "ramp-locked",
  "publish-locking-sibling",
]);

/**
 * Custom validation-hook results as publish gates — the one mapping shared by
 * every entity family, so the skipHooks/ignoreWarnings classification and copy
 * can't drift between them.
 */
export function hookResultsToGates(
  results: {
    hardErrors: string[];
    warnings: string[];
  },
  bypassPermission: Permission,
): PublishGate[] {
  const gates: PublishGate[] = [];
  if (results.hardErrors.length) {
    gates.push({
      type: "custom-hook",
      severity: "blocker",
      messages: [
        "A custom validation hook rejected this publish:",
        ...results.hardErrors,
      ],
      override: "skipHooks",
      requiresPermission: bypassPermission,
      resolution: null,
    });
  }
  if (results.warnings.length) {
    gates.push({
      type: "custom-hook",
      severity: "warning",
      messages: [
        "A custom validation hook raised a warning:",
        ...results.warnings,
      ],
      override: "ignoreWarnings",
      requiresPermission: null,
      resolution: null,
    });
  }
  return gates;
}

/**
 * The clearing signals a request carries, used to decide each gate's
 * disposition. Handlers assemble this from their own bypass computations so the
 * gate evaluation matches the sequential backstops exactly.
 */
export type PublishGateClearance = {
  /** The request asked to force past warnings (body `ignoreWarnings`). */
  ignoreWarnings: boolean;
  // The caller may skip validation-class gates (schema errors, invariants,
  // schema-break, hook failures) — i.e. they passed `skipSchemaValidation` AND
  // hold the entity family's bypass-approval permission. Already resolves flag+permission
  // together (mirrors `context.skipSchemaValidation`), so a skipSchemaValidation
  // gate is bypassed iff this is true — the org REST-bypass setting never grants it.
  skipSchemaValidation: boolean;
  /**
   * The caller may skip a custom validation-hook rejection — passed `skipHooks`
   * AND holds the entity family's bypass-approval permission. Resolves flag+permission
   * together (mirrors `context.skipHooks`).
   */
  skipHooks: boolean;
  /**
   * The caller holds the entity family's bypass-approval permission on the
   * entity's scope.
   */
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

// The gates a request does NOT clear via a request-body flag: a gate is cleared
// only when it has an override flag, that flag was passed, AND (when the gate
// names a required permission) the caller holds that permission. A gate without
// an override is never cleared here. Pure — the flag-clearing primitive shared
// by the disposition logic and exported for unit tests.
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

// Decide whether a single active gate blocks the publish or is bypassed (and by
// what). Pure — exported for unit tests. The flag path reuses `unclearedGates`
// (so its requiresPermission handling stays the single source of truth); the
// non-flag paths encode each gate kind's authority:
// - config-locked: never bypassed on publish (unlock is a separate action).
// Whether authority has already refused this item, so gate collection should stop.
//
// Everything after the authority checks is expensive or side-effecting to a
// caller who cannot land the change: entity guards, schema validation and the
// org's sandboxed Custom Hooks all run there, and the gate list is a full
// enumeration of the org's governance. A permission-denied gate is never
// bypassable, so stopping early cannot change the outcome.
export function authorityRefused(gates: PublishGate[]): boolean {
  return gates.some((g) => g.type === "permission-denied");
}

// - approval-required: bypassed by the bypass-approval permission or the org
// REST setting (labeled by which was the reason).
// - stale-base: bypassed only by ignoreWarnings + force-merge authority.
// - soft guards: bypassed by ignoreWarnings, or the bypass-approval permission.
export function classifyPublishGate(
  gate: PublishGate,
  clearance: PublishGateClearance,
): PublishGateDisposition {
  // Validation-class gates clear ONLY on the privileged skipSchemaValidation
  // signal (which already folds in the bypass-approval permission).
  // Handled explicitly, ahead of the generic flag path, so neither ignoreWarnings
  // nor the org REST-bypass setting can clear a validation failure.
  if (gate.override === "skipSchemaValidation") {
    return clearance.skipSchemaValidation
      ? { outcome: "bypassed", via: "skipSchemaValidation" }
      : { outcome: "blocking" };
  }
  if (gate.override === "skipHooks") {
    return clearance.skipHooks
      ? { outcome: "bypassed", via: "skipHooks" }
      : { outcome: "blocking" };
  }

  const flags: PublishOverrideFlags = {
    ignoreWarnings: clearance.ignoreWarnings,
  };
  // Any family's bypass-approval atom clears a stale base — the gate names the
  // one for its own entity, and the clearance already resolved whether the
  // caller holds it.
  const hasPermission = (permission: string) =>
    isBypassApprovalPermission(permission) && clearance.canForceMergeStaleBase;
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
      return { outcome: "bypassed", via: "bypassApprovalPermission" };
    }
    return { outcome: "blocking" };
  }

  // Feature lockdown gates: safety gates against accidental live-traffic
  // changes, not security boundaries — the single-entity path's bypassLockdown
  // auto-clears them for the same authorities that bypass approval (the
  // permission OR the org REST-bypass setting), with no flag required.
  if (LOCKDOWN_GATE_TYPES.has(gate.type)) {
    if (clearance.bypassApprovalPermission) {
      return { outcome: "bypassed", via: "bypassApprovalPermission" };
    }
    if (clearance.restApiBypassesReviews) {
      return { outcome: "bypassed", via: "restApiBypassesReviews" };
    }
    return { outcome: "blocking" };
  }

  if (SOFT_GUARD_GATE_TYPES.has(gate.type)) {
    if (clearance.bypassApprovalPermission) {
      return { outcome: "bypassed", via: "bypassApprovalPermission" };
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

// Resolve a revision's gates against the caller's clearance, and refuse if any
// survive.
//
// Every per-entity publish handler wired this identically — the four override
// flags, the entity's bypass-approval permission, the org's REST review bypass,
// the stale-base force — and one of them drifted: the Saved Group handler read
// `settings.restApiBypassesReviews` directly, omitting the `!isJwtAuth` guard the
// others get from `canUseRestApiBypassSetting`, so a JWT-backed REST call there
// cleared reviews that Config and Constant refuse. Deciding it once is what stops
// the next copy drifting.
export function resolveEntityPublishGates({
  req,
  gates,
  bypassApprovalPermission,
  canForceMergeStaleBase,
  entityType,
}: {
  req: ReviewBypassRequest;
  gates: PublishGate[];
  bypassApprovalPermission: boolean;
  canForceMergeStaleBase: boolean;
  entityType: "feature" | "config" | "constant" | "saved-group";
}): { bypassed: BypassedGate[] } {
  const { blocking, bypassed } = evaluatePublishGates(gates, {
    ignoreWarnings: req.context.ignoreWarnings,
    // Per-FAMILY, like bulk: the ORed authority let a Constants bypass clear
    // Config schema gates.
    skipSchemaValidation: req.context.canSkipSchemaValidationFor(entityType),
    skipHooks: req.context.canSkipHooksFor(entityType),
    bypassApprovalPermission,
    restApiBypassesReviews: canUseRestApiBypassSetting(req),
    canForceMergeStaleBase,
  });
  if (blocking.length) throw new PublishBlockedError(blocking);
  return { bypassed };
}

export class PublishBlockedError extends Error {
  status = 422;
  gates: PublishGate[];
  // Flattened messages of the gates a plain `ignoreWarnings` retry actually
  // clears — mirroring SoftWarningError's `warnings` so existing ack-and-retry
  // flows don't surface a message they can't acknowledge. Excludes gates that
  // also carry a `requiresPermission` (e.g. stale-base): the flag alone won't
  // clear those, so listing them would loop the ack-and-retry. `gates` keeps
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
      .filter(
        (gate) =>
          gate.override === "ignoreWarnings" && !gate.requiresPermission,
      )
      .flatMap((gate) => gate.messages);
  }
}
