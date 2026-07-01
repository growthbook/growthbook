import {
  evaluateInvariants,
  invariantRuleFields,
  toCel,
  describeInvariantRule,
  celToMongo,
  jsonLogicToMongo,
  mongoToJsonLogic,
  apiInvariantsToStored,
  ConfigInvariant,
} from "../src/util/config-schema/invariants";

// Contract for the mongrule-backed invariants engine. Each rule is a mongo
// condition (mongrule / evalCondition): a rule is SATISFIED when the condition
// matches the resolved value, a VIOLATION when it doesn't. Field-to-field
// comparisons use the `$ref` marker added to mongrule.
//
// The 6 cross-field patterns, in mongo form:
const RULE_DEFS: { name: string; rule: unknown; message: string }[] = [
  // 1. implication: burst_enabled → plan == "pro"   (¬A ∨ B)
  {
    name: "burst_requires_pro",
    rule: {
      $or: [
        { $not: { burst_enabled: { $eq: true } } },
        { plan: { $eq: "pro" } },
      ],
    },
    message: "Burst limits require the Pro plan.",
  },
  // 2. chain leaf: priority_queue_enabled → burst_enabled
  {
    name: "priority_requires_burst",
    rule: {
      $or: [
        { $not: { priority_queue_enabled: { $eq: true } } },
        { burst_enabled: { $eq: true } },
      ],
    },
    message: "Priority queue requires burst limits.",
  },
  // 3. both-or-neither: quota ⇔ (max_requests set)
  {
    name: "quota_iff_limit",
    rule: {
      $or: [
        {
          $and: [
            { quota_enabled: { $eq: true } },
            { max_requests: { $exists: true } },
          ],
        },
        {
          $nor: [
            { quota_enabled: { $eq: true } },
            { max_requests: { $exists: true } },
          ],
        },
      ],
    },
    message: "Quota and max requests must be set together.",
  },
  // 4. mutual exclusion: ¬(allow_overage ∧ hard_cap_enabled)
  {
    name: "overage_cap_exclusive",
    rule: {
      $not: {
        $and: [
          { allow_overage: { $eq: true } },
          { hard_cap_enabled: { $eq: true } },
        ],
      },
    },
    message: "Overage and hard cap can't both be enabled.",
  },
  // 5. enum-dependent: pricing_mode == "usage" → overage set
  {
    name: "usage_requires_rate",
    rule: {
      $or: [
        { $not: { pricing_mode: { $eq: "usage" } } },
        { overage_rate: { $exists: true } },
      ],
    },
    message: "Usage-based billing requires an overage rate.",
  },
  // 6. field-to-field ordering via $ref
  {
    name: "min_le_max_replicas",
    rule: {
      min_replicas: { $lte: { $ref: "max_replicas" } },
    },
    message: "Min replicas cannot exceed max replicas.",
  },
];

const RULES: ConfigInvariant[] = RULE_DEFS.map((r) => ({
  name: r.name,
  rule: JSON.stringify(r.rule),
  message: r.message,
}));

const valid: Record<string, unknown> = {
  plan_tier: "standard",
  plan: "pro",
  burst_enabled: true,
  priority_queue_enabled: true,
  quota_enabled: true,
  max_requests: 25,
  min_replicas: 2,
  max_replicas: 5,
  allow_overage: true,
  hard_cap_enabled: false,
  pricing_mode: "flat",
  overage_rate: null,
};

const names = (value: Record<string, unknown>) =>
  evaluateInvariants(value, RULES).map((v) => v.name);

describe("evaluateInvariants — mongrule engine", () => {
  it("no violations for a fully-valid value", () => {
    expect(evaluateInvariants(valid, RULES)).toEqual([]);
  });

  it("returns [] when there are no invariants", () => {
    expect(evaluateInvariants(valid, [])).toEqual([]);
    expect(evaluateInvariants(valid, undefined)).toEqual([]);
    expect(evaluateInvariants(valid, null)).toEqual([]);
  });

  it("pattern 1 — implication (burst requires Pro)", () => {
    expect(
      names({
        ...valid,
        burst_enabled: true,
        plan: "1080p",
        priority_queue_enabled: false,
      }),
    ).toEqual(["burst_requires_pro"]);
    expect(
      names({
        ...valid,
        burst_enabled: false,
        priority_queue_enabled: false,
        plan: "1080p",
      }),
    ).toEqual([]);
  });

  it("pattern 2 — chain leaf (priority requires burst)", () => {
    expect(
      names({
        ...valid,
        priority_queue_enabled: true,
        burst_enabled: false,
        plan: "1080p",
      }),
    ).toContain("priority_requires_burst");
  });

  it("pattern 3 — both-or-neither (quota ⇔ limit)", () => {
    expect(
      names({
        ...valid,
        quota_enabled: true,
        max_requests: null,
      }),
    ).toContain("quota_iff_limit");
    expect(
      names({
        ...valid,
        quota_enabled: false,
        max_requests: 10,
      }),
    ).toContain("quota_iff_limit");
    expect(
      names({
        ...valid,
        quota_enabled: false,
        max_requests: null,
      }),
    ).not.toContain("quota_iff_limit");
  });

  it("pattern 4 — at-most-one (overage vs cap)", () => {
    expect(
      names({ ...valid, allow_overage: true, hard_cap_enabled: true }),
    ).toContain("overage_cap_exclusive");
    expect(
      names({ ...valid, allow_overage: true, hard_cap_enabled: false }),
    ).not.toContain("overage_cap_exclusive");
  });

  it("pattern 5 — enum-dependent (usage requires rate)", () => {
    expect(
      names({
        ...valid,
        pricing_mode: "usage",
        overage_rate: null,
      }),
    ).toContain("usage_requires_rate");
    expect(
      names({
        ...valid,
        pricing_mode: "usage",
        overage_rate: 5,
      }),
    ).not.toContain("usage_requires_rate");
  });

  it("pattern 6 — field-to-field via $ref (min ≤ max)", () => {
    expect(names({ ...valid, min_replicas: 6, max_replicas: 5 })).toEqual([
      "min_le_max_replicas",
    ]);
    expect(names({ ...valid, min_replicas: 5, max_replicas: 5 })).not.toContain(
      "min_le_max_replicas",
    );
  });

  it("returns the human message, not the rule", () => {
    expect(evaluateInvariants({ ...valid, min_replicas: 9 }, RULES)).toEqual([
      {
        name: "min_le_max_replicas",
        message: "Min replicas cannot exceed max replicas.",
      },
    ]);
  });

  it("treats a missing field as absent (sparse value)", () => {
    // quota absent → not true → iff satisfied when max_requests also absent
    expect(names({ min_replicas: 1, max_replicas: 1 })).not.toContain(
      "quota_iff_limit",
    );
  });

  it("surfaces a malformed rule as a violation instead of throwing", () => {
    const bad: ConfigInvariant[] = [
      { name: "bad_json", rule: "{ not valid json", message: "bad" },
    ];
    let result: ReturnType<typeof evaluateInvariants> = [];
    expect(() => {
      result = evaluateInvariants({}, bad);
    }).not.toThrow();
    expect(result.map((v) => v.name)).toEqual(["bad_json"]);
  });
});

describe("invariantRuleFields — mongrule engine", () => {
  const fields = (r: unknown) => invariantRuleFields(JSON.stringify(r)).sort();

  it("collects the field on a simple condition", () => {
    expect(fields({ plan: { $eq: "pro" } })).toEqual(["plan"]);
  });

  it("collects both sides of a $ref comparison", () => {
    expect(
      fields({
        min_replicas: { $lte: { $ref: "max_replicas" } },
      }),
    ).toEqual(["max_replicas", "min_replicas"]);
  });

  it("recurses through $or / $and / $not", () => {
    expect(
      fields({
        $or: [
          { $not: { burst_enabled: { $eq: true } } },
          { plan: { $eq: "pro" } },
        ],
      }),
    ).toEqual(["burst_enabled", "plan"]);
  });

  it("returns [] for an unparseable rule", () => {
    expect(invariantRuleFields("{ not json")).toEqual([]);
  });
});

describe("format converters (mongo canonical, CEL/JSONLogic at the boundary)", () => {
  const IMPLICATION = {
    $or: [{ $not: { burst_enabled: { $eq: true } } }, { plan: { $eq: "pro" } }],
  };
  const EXCLUSIVE = {
    $not: {
      $and: [
        { allow_overage: { $eq: true } },
        { hard_cap_enabled: { $eq: true } },
      ],
    },
  };
  const ORDERING = {
    min_replicas: { $lte: { $ref: "max_replicas" } },
  };

  it("toCel: mongo → CEL", () => {
    expect(toCel(JSON.stringify(IMPLICATION))).toBe(
      "!burst_enabled || plan == 'pro'",
    );
    expect(toCel(JSON.stringify(EXCLUSIVE))).toBe(
      "!(allow_overage && hard_cap_enabled)",
    );
    expect(toCel(JSON.stringify(ORDERING))).toBe(
      "min_replicas <= max_replicas",
    );
  });

  it("describeInvariantRule: mongo → friendly", () => {
    expect(describeInvariantRule(JSON.stringify(IMPLICATION))).toBe(
      "IF burst_enabled THEN plan == 'pro'",
    );
    expect(describeInvariantRule(JSON.stringify(ORDERING))).toBe(
      "min_replicas ≤ max_replicas",
    );
    expect(
      describeInvariantRule(
        JSON.stringify({ max_requests: { $exists: true } }),
      ),
    ).toBe("max_requests is set");
  });

  it("celToMongo: CEL → mongo", () => {
    expect(celToMongo("min_replicas <= max_replicas")).toEqual(ORDERING);
    expect(celToMongo("!burst_enabled || plan == 'pro'")).toEqual(IMPLICATION);
    expect(celToMongo("!(allow_overage && hard_cap_enabled)")).toEqual(
      EXCLUSIVE,
    );
  });

  it("celToMongo: rejects a malformed number instead of storing null", () => {
    expect(() => celToMongo("replicas == 1.2.3")).toThrow(/number/i);
    // a valid number still parses
    expect(celToMongo("replicas == 3")).toEqual({ replicas: { $eq: 3 } });
  });

  it("jsonLogicToMongo: JSONLogic → mongo", () => {
    expect(
      jsonLogicToMongo({
        "<=": [{ var: "min_replicas" }, { var: "max_replicas" }],
      }),
    ).toEqual(ORDERING);
    expect(
      jsonLogicToMongo({
        or: [
          { "!": { var: "burst_enabled" } },
          { "==": [{ var: "plan" }, "pro"] },
        ],
      }),
    ).toEqual(IMPLICATION);
  });

  it("mongoToJsonLogic: mongo → JSONLogic", () => {
    expect(mongoToJsonLogic(JSON.stringify(ORDERING))).toEqual({
      "<=": [{ var: "min_replicas" }, { var: "max_replicas" }],
    });
  });

  it("keeps every operator in a multi-operator field condition", () => {
    // A range `{price: {$gte, $lte}}` must not silently drop a bound when
    // exported to CEL / JSONLogic / a readable description.
    const RANGE = { price: { $gte: 0, $lte: 100 } };
    expect(toCel(JSON.stringify(RANGE))).toBe("price >= 0 && price <= 100");
    expect(describeInvariantRule(JSON.stringify(RANGE))).toBe(
      "price ≥ 0 AND price ≤ 100",
    );
    expect(mongoToJsonLogic(JSON.stringify(RANGE))).toEqual({
      and: [{ ">=": [{ var: "price" }, 0] }, { "<=": [{ var: "price" }, 100] }],
    });
  });

  it("converts the both-or-neither (iff) JSONLogic pattern to mongo", () => {
    // `A == (B != null)` — a comparison whose operand is itself a boolean
    // expression. Must expand to the iff shape, not leave JSONLogic in $eq.
    const jl = {
      "==": [
        { var: "quota_enabled" },
        { "!=": [{ var: "max_requests" }, null] },
      ],
    };
    const IFF = {
      $or: [
        {
          $and: [
            { quota_enabled: { $eq: true } },
            { max_requests: { $ne: null } },
          ],
        },
        {
          $nor: [
            { quota_enabled: { $eq: true } },
            { max_requests: { $ne: null } },
          ],
        },
      ],
    };
    expect(jsonLogicToMongo(jl)).toEqual(IFF);
    expect(describeInvariantRule(JSON.stringify(IFF))).toBe(
      "quota_enabled IF AND ONLY IF max_requests is set",
    );
    expect(invariantRuleFields(JSON.stringify(IFF)).sort()).toEqual([
      "max_requests",
      "quota_enabled",
    ]);
    const rule = [
      { name: "iff", rule: JSON.stringify(IFF), message: "must match" },
    ];
    // Both set → satisfied; only one set → violation.
    expect(
      evaluateInvariants({ quota_enabled: true, max_requests: 25 }, rule),
    ).toHaveLength(0);
    expect(
      evaluateInvariants({ quota_enabled: true, max_requests: null }, rule),
    ).toHaveLength(1);
  });

  it("apiInvariantsToStored: mongo passes through; JSONLogic + CEL convert", () => {
    const mongo = {
      $or: [
        { $not: { burst_enabled: { $eq: true } } },
        { plan: { $eq: "pro" } },
      ],
    };
    // Single-key mongo (`$or`) must pass through, not get mis-routed to the
    // JSONLogic converter (which would throw "Unsupported operator $or").
    const [fromMongo] = apiInvariantsToStored([
      { name: "r", rule: mongo, message: "m" },
    ]);
    expect(JSON.parse(fromMongo.rule)).toEqual(mongo);

    const [fromJl] = apiInvariantsToStored([
      {
        name: "r",
        rule: {
          or: [
            { "!": { var: "burst_enabled" } },
            { "==": [{ var: "plan" }, "pro"] },
          ],
        },
        message: "m",
      },
    ]);
    expect(JSON.parse(fromJl.rule)).toEqual(mongo);

    const [fromCel] = apiInvariantsToStored([
      {
        name: "r",
        rule: "!burst_enabled || plan == 'pro'",
        message: "m",
      },
    ]);
    expect(JSON.parse(fromCel.rule)).toEqual(mongo);
  });

  it("round-trips CEL → mongo → CEL", () => {
    for (const cel of [
      "!burst_enabled || plan == 'pro'",
      "min_replicas <= max_replicas",
      "!(allow_overage && hard_cap_enabled)",
      "pricing_mode != 'usage' || overage_rate != null",
    ]) {
      expect(toCel(JSON.stringify(celToMongo(cel)))).toBe(cel);
    }
  });

  it("uploaded CEL/JSONLogic evaluate the same once stored as mongo", () => {
    const fromCel = celToMongo("min_replicas <= max_replicas");
    const fromJl = jsonLogicToMongo({
      "<=": [{ var: "min_replicas" }, { var: "max_replicas" }],
    });
    const rules = (rule: unknown): ConfigInvariant[] => [
      { name: "r", rule: JSON.stringify(rule), message: "replicas too high" },
    ];
    const bad = { min_replicas: 6, max_replicas: 5 };
    const ok = { min_replicas: 2, max_replicas: 5 };
    expect(evaluateInvariants(bad, rules(fromCel))).toHaveLength(1);
    expect(evaluateInvariants(ok, rules(fromCel))).toHaveLength(0);
    expect(evaluateInvariants(bad, rules(fromJl))).toHaveLength(1);
  });
});
