import {
  PublishBlockedError,
  PublishGate,
  assertPublishGates,
  unclearedGates,
} from "back-end/src/revisions/publishGates";

// No override flag: cleared only by approving the revision or by a caller
// whose permission bypasses approval implicitly (in which case the handler
// never emits the gate).
const approvalGate: PublishGate = {
  type: "approval-required",
  severity: "blocker",
  messages: [
    "Requires approval — submit the revision for review, or a caller with the bypassApprovalChecks permission can publish directly.",
  ],
};

// No override flag: a hard lock's only escape is an explicit unlock.
const configLockedGate: PublishGate = {
  type: "config-locked",
  severity: "blocker",
  messages: [
    "Locked at revision v3 — unlock first via POST /configs/pricing/unlock (requires the bypassApprovalChecks permission).",
  ],
};

const staleBaseGate: PublishGate = {
  type: "stale-base",
  severity: "blocker",
  messages: ["This revision was created against an older version."],
  override: "ignoreWarnings",
  requiresPermission: "bypassApprovalChecks",
};

const experimentGuardGate: PublishGate = {
  type: "experiment-guard",
  severity: "warning",
  messages: ["Publishing rewrites a value served to a running experiment."],
  override: "ignoreWarnings",
};

const schemaBreakGate: PublishGate = {
  type: "schema-break",
  severity: "warning",
  messages: [
    "Publishing would make dependent value(s) violate their schema:",
    'config "pricing" field "tier" expects a string',
  ],
  override: "ignoreWarnings",
};

const allPermissions = () => true;
const noPermissions = () => false;

describe("unclearedGates", () => {
  it("returns every gate when no override flags are passed", () => {
    const gates = [approvalGate, staleBaseGate, experimentGuardGate];
    expect(unclearedGates(gates, {}, allPermissions)).toEqual(gates);
  });

  it("returns an empty list for an empty gate list", () => {
    expect(
      unclearedGates([], { ignoreWarnings: true }, allPermissions),
    ).toEqual([]);
  });

  it("clears only the gates whose override flag was passed", () => {
    expect(
      unclearedGates([staleBaseGate, experimentGuardGate], {}, allPermissions),
    ).toEqual([staleBaseGate, experimentGuardGate]);
    expect(
      unclearedGates(
        [staleBaseGate, experimentGuardGate],
        { ignoreWarnings: true },
        allPermissions,
      ),
    ).toEqual([]);
  });

  it("never clears a gate without an override flag", () => {
    expect(
      unclearedGates(
        [
          approvalGate,
          configLockedGate,
          staleBaseGate,
          experimentGuardGate,
          schemaBreakGate,
        ],
        { ignoreWarnings: true, skipSchemaValidation: true },
        allPermissions,
      ),
    ).toEqual([approvalGate, configLockedGate]);
  });

  it("keeps a gate when its flag is passed but the required permission is missing", () => {
    expect(
      unclearedGates(
        [staleBaseGate, experimentGuardGate],
        { ignoreWarnings: true },
        noPermissions,
      ),
    ).toEqual([staleBaseGate]);
  });

  it("checks the permission the gate names", () => {
    const seen: string[] = [];
    unclearedGates([staleBaseGate], { ignoreWarnings: true }, (permission) => {
      seen.push(permission);
      return true;
    });
    expect(seen).toEqual(["bypassApprovalChecks"]);
  });

  it("does not consult permissions for gates without requiresPermission", () => {
    const fail = () => {
      throw new Error("should not be called");
    };
    expect(
      unclearedGates([experimentGuardGate], { ignoreWarnings: true }, fail),
    ).toEqual([]);
  });

  it("only treats an explicit true as a passed flag", () => {
    expect(
      unclearedGates(
        [experimentGuardGate],
        { ignoreWarnings: undefined },
        allPermissions,
      ),
    ).toEqual([experimentGuardGate]);
  });
});

describe("assertPublishGates", () => {
  it("does nothing when every gate is cleared", () => {
    expect(() =>
      assertPublishGates(
        [staleBaseGate, experimentGuardGate],
        { ignoreWarnings: true },
        allPermissions,
      ),
    ).not.toThrow();
  });

  it("throws a PublishBlockedError carrying only the uncleared gates", () => {
    let caught: unknown;
    try {
      assertPublishGates(
        [approvalGate, experimentGuardGate],
        { ignoreWarnings: true },
        allPermissions,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PublishBlockedError);
    expect((caught as PublishBlockedError).gates).toEqual([approvalGate]);
  });

  it("consults the caller-supplied permission check for flag overrides", () => {
    expect(() =>
      assertPublishGates(
        [staleBaseGate],
        { ignoreWarnings: true },
        noPermissions,
      ),
    ).toThrow(PublishBlockedError);
  });
});

describe("PublishBlockedError", () => {
  it("is a 422 with the typed gates", () => {
    const err = new PublishBlockedError([approvalGate, schemaBreakGate]);
    expect(err.status).toBe(422);
    expect(err.gates).toEqual([approvalGate, schemaBreakGate]);
  });

  it("flattens only ignoreWarnings-clearable gate messages into warnings", () => {
    const err = new PublishBlockedError([approvalGate, schemaBreakGate]);
    expect(err.warnings).toEqual(schemaBreakGate.messages);
  });

  it("names each gate's override flag (and required permission) in the message", () => {
    const err = new PublishBlockedError([staleBaseGate, experimentGuardGate]);
    expect(err.message).toContain("Publish blocked by 2 gate(s):");
    expect(err.message).toContain("[stale-base]");
    expect(err.message).toContain('retry with "ignoreWarnings": true');
    expect(err.message).toContain(
      "requires the bypassApprovalChecks permission",
    );
    expect(err.message).toContain("[experiment-guard]");
  });

  it("shows no retry hint for a gate without an override flag", () => {
    const err = new PublishBlockedError([approvalGate]);
    expect(err.message).toContain("[approval-required]");
    expect(err.message).toContain(approvalGate.messages[0]);
    expect(err.message).not.toContain("retry with");
  });

  it("reports a hard-lock gate alongside clearable gates, outside warnings", () => {
    const err = new PublishBlockedError([configLockedGate, schemaBreakGate]);
    expect(err.message).toContain("Publish blocked by 2 gate(s):");
    expect(err.message).toContain("[config-locked]");
    expect(err.message).toContain(configLockedGate.messages[0]);
    expect(err.gates).toEqual([configLockedGate, schemaBreakGate]);
    expect(err.warnings).toEqual(schemaBreakGate.messages);
  });
});
