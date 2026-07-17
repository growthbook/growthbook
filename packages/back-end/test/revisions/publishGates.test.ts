import {
  BypassedGate,
  PublishBlockedError,
  PublishGate,
  PublishGateClearance,
  classifyPublishGate,
  evaluatePublishGates,
  unclearedGates,
} from "back-end/src/revisions/publishGates";

// No override flag: cleared only by approving the revision, by a caller whose
// permission bypasses approval, or by the org REST-bypass setting.
const approvalGate: PublishGate = {
  type: "approval-required",
  severity: "blocker",
  messages: ['Requires approval before publishing (status: "draft").'],
  override: null,
  requiresPermission: "bypassApprovalChecks",
  resolution: {
    action: "request-review",
    method: "POST",
    path: "/configs-revisions/pricing/3/request-review",
  },
};

// No override flag: a hard lock's only escape is an explicit unlock action.
const configLockedGate: PublishGate = {
  type: "config-locked",
  severity: "blocker",
  messages: ["Locked at revision v3."],
  override: null,
  requiresPermission: "bypassApprovalChecks",
  resolution: {
    action: "unlock",
    method: "POST",
    path: "/configs/pricing/unlock",
  },
};

const staleBaseGate: PublishGate = {
  type: "stale-base",
  severity: "blocker",
  messages: ["This revision was created against an older version."],
  override: "ignoreWarnings",
  requiresPermission: "bypassApprovalChecks",
  resolution: {
    action: "rebase",
    method: "POST",
    path: "/configs-revisions/pricing/3/rebase",
  },
};

const experimentGuardGate: PublishGate = {
  type: "experiment-guard",
  severity: "warning",
  messages: ["Publishing rewrites a value served to a running experiment."],
  override: "ignoreWarnings",
  requiresPermission: null,
  resolution: null,
};

const schemaBreakGate: PublishGate = {
  type: "schema-break",
  severity: "warning",
  messages: [
    "Publishing would make dependent value(s) violate their schema:",
    'config "pricing" field "tier" expects a string',
  ],
  override: "ignoreWarnings",
  requiresPermission: null,
  resolution: null,
};

const allPermissions = () => true;
const noPermissions = () => false;

// A clearance with every signal off; individual tests override the fields they exercise.
const noClearance: PublishGateClearance = {
  ignoreWarnings: false,
  bypassApprovalPermission: false,
  restApiBypassesReviews: false,
  canForceMergeStaleBase: false,
};
const clearance = (
  overrides: Partial<PublishGateClearance>,
): PublishGateClearance => ({ ...noClearance, ...overrides });

describe("uniform gate fields", () => {
  it("every gate carries override, requiresPermission, and resolution (null or set)", () => {
    const gates = [
      approvalGate,
      configLockedGate,
      staleBaseGate,
      experimentGuardGate,
      schemaBreakGate,
    ];
    for (const gate of gates) {
      expect(gate).toHaveProperty("override");
      expect(gate).toHaveProperty("requiresPermission");
      expect(gate).toHaveProperty("resolution");
    }
    // Explicit null where no flag / permission / route applies.
    expect(approvalGate.override).toBeNull();
    expect(experimentGuardGate.requiresPermission).toBeNull();
    expect(experimentGuardGate.resolution).toBeNull();
    // Set where they apply.
    expect(staleBaseGate.override).toBe("ignoreWarnings");
    expect(configLockedGate.resolution).toEqual({
      action: "unlock",
      method: "POST",
      path: "/configs/pricing/unlock",
    });
  });
});

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

describe("classifyPublishGate", () => {
  it("keeps a hard lock blocking even with full clearance", () => {
    expect(
      classifyPublishGate(
        configLockedGate,
        clearance({
          ignoreWarnings: true,
          bypassApprovalPermission: true,
          restApiBypassesReviews: true,
          canForceMergeStaleBase: true,
        }),
      ),
    ).toEqual({ outcome: "blocking" });
  });

  describe("approval-required", () => {
    it("blocks without any bypass authority", () => {
      expect(classifyPublishGate(approvalGate, noClearance)).toEqual({
        outcome: "blocking",
      });
    });

    it("is bypassed by the bypass-approval permission", () => {
      expect(
        classifyPublishGate(
          approvalGate,
          clearance({ bypassApprovalPermission: true }),
        ),
      ).toEqual({ outcome: "bypassed", via: "bypassApprovalChecks" });
    });

    it("is bypassed (and labeled) by the org REST setting, which wins over the permission", () => {
      expect(
        classifyPublishGate(
          approvalGate,
          clearance({
            bypassApprovalPermission: true,
            restApiBypassesReviews: true,
          }),
        ),
      ).toEqual({ outcome: "bypassed", via: "restApiBypassesReviews" });
    });
  });

  describe("stale-base", () => {
    it("blocks when only ignoreWarnings is set (no force-merge authority)", () => {
      expect(
        classifyPublishGate(staleBaseGate, clearance({ ignoreWarnings: true })),
      ).toEqual({ outcome: "blocking" });
    });

    it("blocks when force-merge authority exists but ignoreWarnings is absent", () => {
      expect(
        classifyPublishGate(
          staleBaseGate,
          clearance({ canForceMergeStaleBase: true }),
        ),
      ).toEqual({ outcome: "blocking" });
    });

    it("is bypassed only by ignoreWarnings + force-merge authority", () => {
      expect(
        classifyPublishGate(
          staleBaseGate,
          clearance({ ignoreWarnings: true, canForceMergeStaleBase: true }),
        ),
      ).toEqual({ outcome: "bypassed", via: "ignoreWarnings" });
    });
  });

  describe("soft guards", () => {
    it("is bypassed by ignoreWarnings", () => {
      expect(
        classifyPublishGate(
          experimentGuardGate,
          clearance({ ignoreWarnings: true }),
        ),
      ).toEqual({ outcome: "bypassed", via: "ignoreWarnings" });
    });

    it("is bypassed by the bypass-approval permission alone", () => {
      expect(
        classifyPublishGate(
          schemaBreakGate,
          clearance({ bypassApprovalPermission: true }),
        ),
      ).toEqual({ outcome: "bypassed", via: "bypassApprovalChecks" });
    });

    it("is NOT bypassed by the REST setting alone (permission-only, matching the collector)", () => {
      expect(
        classifyPublishGate(
          schemaBreakGate,
          clearance({ restApiBypassesReviews: true }),
        ),
      ).toEqual({ outcome: "blocking" });
    });

    it("blocks with no clearance", () => {
      expect(classifyPublishGate(experimentGuardGate, noClearance)).toEqual({
        outcome: "blocking",
      });
    });
  });
});

describe("evaluatePublishGates", () => {
  it("partitions active gates into blocking and bypassed", () => {
    const { blocking, bypassed } = evaluatePublishGates(
      [approvalGate, staleBaseGate, experimentGuardGate, configLockedGate],
      clearance({
        ignoreWarnings: true,
        bypassApprovalPermission: true,
        canForceMergeStaleBase: true,
      }),
    );
    // config-locked never bypasses; the rest are cleared by the clearance.
    expect(blocking).toEqual([configLockedGate]);
    const expectedBypassed: BypassedGate[] = [
      {
        type: "approval-required",
        outcome: "bypassed",
        via: "bypassApprovalChecks",
      },
      { type: "stale-base", outcome: "bypassed", via: "ignoreWarnings" },
      { type: "experiment-guard", outcome: "bypassed", via: "ignoreWarnings" },
    ];
    expect(bypassed).toEqual(expectedBypassed);
  });

  it("returns no bypassed entries when nothing is cleared", () => {
    const { blocking, bypassed } = evaluatePublishGates(
      [approvalGate, staleBaseGate],
      noClearance,
    );
    expect(blocking).toEqual([approvalGate, staleBaseGate]);
    expect(bypassed).toEqual([]);
  });

  it("returns empty partitions for an empty gate list", () => {
    expect(evaluatePublishGates([], noClearance)).toEqual({
      blocking: [],
      bypassed: [],
    });
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
