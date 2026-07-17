import {
  PublishBlockedError,
  PublishGate,
  unclearedGates,
} from "back-end/src/revisions/publishGates";

const approvalGate: PublishGate = {
  type: "approval-required",
  severity: "blocker",
  messages: ["This revision requires approval before publishing."],
  override: "bypassApproval",
  requiresPermission: "bypassApprovalChecks",
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
      unclearedGates(
        [approvalGate, staleBaseGate, experimentGuardGate],
        { ignoreWarnings: true },
        allPermissions,
      ),
    ).toEqual([approvalGate]);
  });

  it("clears each gate by its own flag across mixed severities", () => {
    expect(
      unclearedGates(
        [approvalGate, staleBaseGate, experimentGuardGate, schemaBreakGate],
        { bypassApproval: true, ignoreWarnings: true },
        allPermissions,
      ),
    ).toEqual([]);
  });

  it("keeps a gate when its flag is passed but the required permission is missing", () => {
    expect(
      unclearedGates(
        [approvalGate, experimentGuardGate],
        { bypassApproval: true, ignoreWarnings: true },
        noPermissions,
      ),
    ).toEqual([approvalGate]);
  });

  it("checks the permission the gate names", () => {
    const seen: string[] = [];
    unclearedGates(
      [approvalGate, staleBaseGate],
      { bypassApproval: true, ignoreWarnings: true },
      (permission) => {
        seen.push(permission);
        return true;
      },
    );
    expect(seen).toEqual(["bypassApprovalChecks", "bypassApprovalChecks"]);
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

describe("PublishBlockedError", () => {
  it("is a 422 with the typed gates and flattened warnings", () => {
    const err = new PublishBlockedError([approvalGate, schemaBreakGate]);
    expect(err.status).toBe(422);
    expect(err.gates).toEqual([approvalGate, schemaBreakGate]);
    expect(err.warnings).toEqual([
      ...approvalGate.messages,
      ...schemaBreakGate.messages,
    ]);
  });

  it("names each gate's override flag (and required permission) in the message", () => {
    const err = new PublishBlockedError([approvalGate, experimentGuardGate]);
    expect(err.message).toContain("Publish blocked by 2 gate(s):");
    expect(err.message).toContain("[approval-required]");
    expect(err.message).toContain('retry with "bypassApproval": true');
    expect(err.message).toContain(
      "requires the bypassApprovalChecks permission",
    );
    expect(err.message).toContain("[experiment-guard]");
    expect(err.message).toContain('retry with "ignoreWarnings": true');
  });
});
