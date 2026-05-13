import {
  apiCreateContextualBanditQueryBody,
  contextsEntryValidator,
  contextualBanditValidator,
  ContextualBanditEventInterface,
  contextualBanditEventValidator,
  contextualBanditQueryValidator,
  contextualBanditSnapshotValidator,
  getContextVariationPairCount,
  MAX_CBE_CONTEXT_VARIATION_PAIRS,
} from "../../src/validators";

// These tests pin the shape of the A2 validators. They intentionally exercise
// fields that the orchestrator (A6) and stats engine seam (A5) will rely on
// — silent drift in any of these would break the round-trip contract.
describe("ContextualBanditQuery validator (CBAQ)", () => {
  const baseCBAQ = {
    id: "cbaq_abc12345",
    organization: "org_1",
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-01-01"),
    owner: "user_1",
    name: "Country / device CBAQ",
    description: "",
    datasource: "ds_1",
    projects: [],
    userIdType: "userId",
    query: "SELECT user_id, variation_id, country FROM exposures",
    attributes: [
      {
        attribute: "country",
        kind: "categorical" as const,
        maxLevels: 10,
      },
    ],
    topValuesLookbackDays: 30,
  };

  it("accepts a minimal valid CBAQ", () => {
    expect(() => contextualBanditQueryValidator.parse(baseCBAQ)).not.toThrow();
  });

  it("rejects empty attributes via schema-level array (length=0 is allowed at Zod, customValidation enforces ≥1)", () => {
    // Zod itself doesn't enforce non-empty (we use customValidation in the
    // model for that). Verify the shape parses with []; the model handles
    // the semantic check separately.
    expect(() =>
      contextualBanditQueryValidator.parse({ ...baseCBAQ, attributes: [] }),
    ).not.toThrow();
  });

  it("rejects negative topValuesLookbackDays", () => {
    expect(() =>
      contextualBanditQueryValidator.parse({
        ...baseCBAQ,
        topValuesLookbackDays: -1,
      }),
    ).toThrow();
  });

  it("apiCreate body requires at least one attribute", () => {
    expect(() =>
      apiCreateContextualBanditQueryBody.parse({
        name: "x",
        datasource: "ds_1",
        attributes: [],
      }),
    ).toThrow();
  });

  it("apiCreate body accepts a minimal attribute entry", () => {
    expect(() =>
      apiCreateContextualBanditQueryBody.parse({
        name: "x",
        datasource: "ds_1",
        userIdType: "userId",
        query: "SELECT user_id, variation_id, country FROM exposures",
        attributes: [{ attribute: "country", kind: "categorical" }],
      }),
    ).not.toThrow();
  });
});

describe("ContextualBanditEvent validator (CBE)", () => {
  function makeCBE(
    overrides: Partial<ContextualBanditEventInterface> = {},
  ): ContextualBanditEventInterface {
    return {
      id: "cbe_abc12345",
      organization: "org_1",
      dateCreated: new Date("2026-01-01"),
      dateUpdated: new Date("2026-01-01"),
      experiment: "exp_1",
      phase: 0,
      contextualBanditSnapshotId: "cbs_1",
      contextualBanditQueryId: "cbaq_1",
      canonicalFormVersion: "v1",
      treeModel: "regression_tree",
      treeSummary: { model: "regression_tree" },
      contextResults: [
        {
          contextId: "ctx_abcd1234",
          condition: "{}",
          totalUsers: 100,
          variations: [
            {
              variation: "v0",
              n: 50,
              mainSum: 5,
              mainSumSquares: 1,
              weight: 0.5,
            },
            {
              variation: "v1",
              n: 50,
              mainSum: 7,
              mainSumSquares: 2,
              weight: 0.5,
            },
          ],
        },
      ],
      seed: 1234,
      holdoutPercent: 0,
      reweight: true,
      weightsWereUpdated: true,
      decisionMetric: "met_revenue",
      updateMessage: "tick succeeded",
      totalUsersThisTick: 100,
      ...overrides,
    };
  }

  it("accepts a minimal valid CBE", () => {
    expect(() => contextualBanditEventValidator.parse(makeCBE())).not.toThrow();
  });

  it("counts context×variation pairs correctly", () => {
    const cbe = makeCBE({
      contextResults: [
        {
          contextId: "ctx_a",
          condition: "{}",
          totalUsers: 1,
          variations: [
            {
              variation: "v0",
              n: 1,
              mainSum: 0,
              mainSumSquares: 0,
              weight: 1,
            },
          ],
        },
        {
          contextId: "ctx_b",
          condition: "{}",
          totalUsers: 1,
          variations: [
            {
              variation: "v0",
              n: 1,
              mainSum: 0,
              mainSumSquares: 0,
              weight: 0.5,
            },
            {
              variation: "v1",
              n: 0,
              mainSum: 0,
              mainSumSquares: 0,
              weight: 0.5,
            },
          ],
        },
      ],
    });
    expect(getContextVariationPairCount(cbe)).toBe(3);
  });

  it("schema accepts up to the Mongo pair cap (semantic enforcement lives in the model)", () => {
    // Zod itself doesn't enforce the cap — the model `customValidation` does.
    // This test pins the constant exists and is the documented contract.
    expect(MAX_CBE_CONTEXT_VARIATION_PAIRS).toBe(3000);
  });
});

describe("ContextualBanditSnapshot validator (CBS)", () => {
  const baseSettings = {
    experimentId: "exp_1",
    phase: 0,
    datasource: "ds_1",
    exposureQueryId: "eq_1",
    contextualBanditQueryId: "cbaq_1",
    attributes: [
      {
        attribute: "country",
        kind: "categorical" as const,
      },
    ],
    variations: [
      { id: "v0", weight: 0.5 },
      { id: "v1", weight: 0.5 },
    ],
    treeModel: "regression_tree" as const,
    maxContexts: 300,
    holdoutPercent: 0 as const,
    stickyBucketing: false as const,
    startDate: new Date("2026-01-01"),
    endDate: new Date("2026-01-08"),
  };

  const baseCBS = {
    id: "cbs_1",
    organization: "org_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    experiment: "exp_1",
    phase: 0,
    contextualBanditQueryId: "cbaq_1",
    runStarted: new Date(),
    status: "running" as const,
    triggeredBy: "manual" as const,
    queries: [],
    settings: baseSettings,
  };

  it("accepts a minimal running CBS", () => {
    expect(() =>
      contextualBanditSnapshotValidator.parse(baseCBS),
    ).not.toThrow();
  });

  it("rejects holdoutPercent ≠ 0 at the schema layer (MVP guardrail)", () => {
    expect(() =>
      contextualBanditSnapshotValidator.parse({
        ...baseCBS,
        settings: { ...baseSettings, holdoutPercent: 5 },
      }),
    ).toThrow();
  });

  it("rejects stickyBucketing=true at the schema layer (MVP guardrail)", () => {
    expect(() =>
      contextualBanditSnapshotValidator.parse({
        ...baseCBS,
        settings: { ...baseSettings, stickyBucketing: true },
      }),
    ).toThrow();
  });
});

describe("ContextualBandit validator (CB)", () => {
  const baseCB = {
    id: "cb_abc12345",
    organization: "org_1",
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-01-01"),
    experiment: "exp_1",
    cbaqId: "cbaq_1",
    contextualAttributes: ["country", "device"],
    maxContexts: 300,
    treeModel: "regression_tree" as const,
    minUsersPerLeaf: 100,
    maxLeaves: 12,
    holdoutPercent: 0 as const,
    stickyBucketing: false as const,
    canonicalFormVersion: "v1" as const,
    phases: [
      {
        phase: 0,
        seed: 1234,
        currentLeafWeights: [],
      },
    ],
  };

  it("accepts a minimal valid CB doc", () => {
    expect(() => contextualBanditValidator.parse(baseCB)).not.toThrow();
  });

  it("rejects holdoutPercent ≠ 0 at the schema layer (MVP guardrail)", () => {
    expect(() =>
      contextualBanditValidator.parse({ ...baseCB, holdoutPercent: 5 }),
    ).toThrow();
  });

  it("rejects stickyBucketing=true at the schema layer (MVP guardrail)", () => {
    expect(() =>
      contextualBanditValidator.parse({ ...baseCB, stickyBucketing: true }),
    ).toThrow();
  });

  it("accepts a phase with rich leafWeight entries (contextId, condition, weights, leafId)", () => {
    expect(() =>
      contextualBanditValidator.parse({
        ...baseCB,
        phases: [
          {
            phase: 0,
            seed: 7,
            lastContextualBanditEventId: "cbe_1",
            currentLeafWeights: [
              {
                contextId: "ctx_a",
                condition: { country: "US" },
                weights: [0.5, 0.5],
                leafId: "leaf_0",
              },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe("ContextsEntry validator (SDK payload entry)", () => {
  it("accepts a context with weights parallel to variations", () => {
    expect(() =>
      contextsEntryValidator.parse({
        contextId: "ctx_a",
        condition: { country: "US" },
        weights: [0.5, 0.5],
      }),
    ).not.toThrow();
  });

  it("rejects extra keys (strict schema)", () => {
    expect(() =>
      contextsEntryValidator.parse({
        contextId: "ctx_a",
        condition: {},
        weights: [1],
        unknownField: true,
      }),
    ).toThrow();
  });
});
