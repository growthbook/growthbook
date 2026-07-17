import {
  evaluateInvariants,
  invariantRuleFields,
  describeInvariantRule,
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

  it("ignores literal-object keys on the value side", () => {
    // `status` equals the literal object {active:true} — `active` is data, not a
    // referenced field. Same for object members inside a `$in` list.
    expect(fields({ status: { active: true } })).toEqual(["status"]);
    expect(fields({ tier: { $in: [{ a: 1 }, { b: 2 }] } })).toEqual(["tier"]);
  });

  it("still collects a $ref nested inside a value", () => {
    expect(fields({ x: { $in: [{ $ref: "y" }] } })).toEqual(["x", "y"]);
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

describe("describeInvariantRule + apiInvariantsToStored (mongo canonical)", () => {
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

  it("describeInvariantRule: mongo → friendly", () => {
    expect(describeInvariantRule(JSON.stringify(IMPLICATION))).toBe(
      'IF burst_enabled THEN plan == "pro"',
    );
    expect(describeInvariantRule(JSON.stringify(EXCLUSIVE))).toBe(
      "NOT (allow_overage AND hard_cap_enabled)",
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

  it("describes a logical operator beside a field condition", () => {
    // `{$or:[…], c:…}` — the field must be AND-ed, not read as a field "$or".
    const rule = { $or: [{ a: { $eq: 1 } }, { b: { $eq: 2 } }], c: { $eq: 3 } };
    expect(describeInvariantRule(JSON.stringify(rule))).toBe(
      "(a == 1 OR b == 2) AND c == 3",
    );
  });

  it("describes every operator in a multi-operator field condition", () => {
    // A range `{price: {$gte, $lte}}` must not silently drop a bound.
    const RANGE = { price: { $gte: 0, $lte: 100 } };
    expect(describeInvariantRule(JSON.stringify(RANGE))).toBe(
      "price ≥ 0 AND price ≤ 100",
    );
  });

  it("describes and evaluates the both-or-neither (iff) shape", () => {
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

  it("apiInvariantsToStored: a mongo condition passes through as the stored string", () => {
    const [stored] = apiInvariantsToStored([
      { name: "r", rule: IMPLICATION, message: "m" },
    ]);
    expect(JSON.parse(stored.rule)).toEqual(IMPLICATION);
  });

  it("apiInvariantsToStored: rejects a non-object rule", () => {
    expect(() =>
      apiInvariantsToStored([
        { name: "r", rule: "min_replicas <= max_replicas", message: "m" },
      ]),
    ).toThrow(/mongo condition object/);
    expect(() =>
      apiInvariantsToStored([{ name: "r", rule: [1, 2], message: "m" }]),
    ).toThrow(/mongo condition object/);
  });

  it("a $ref to a missing field named after an Object.prototype member resolves to null", () => {
    const invariants: ConfigInvariant[] = [
      {
        name: "r",
        rule: JSON.stringify({ a: { $eq: { $ref: "toString" } } }),
        message: "m",
      },
    ];
    // `toString` is absent from the value, so `a` compares against null — the
    // inherited function must not leak in through the prototype chain.
    expect(evaluateInvariants({ a: null }, invariants)).toHaveLength(0);
    expect(evaluateInvariants({ a: 1 }, invariants)).toHaveLength(1);
  });

  it("skips unsafe keys (__proto__) when resolving rule refs", () => {
    const invariants: ConfigInvariant[] = [
      {
        name: "r",
        rule: '{"__proto__":{"x":{"$ref":"a"}},"b":{"$eq":{"$ref":"a"}}}',
        message: "m",
      },
    ];
    expect(evaluateInvariants({ a: 2, b: 2 }, invariants)).toHaveLength(0);
    expect(evaluateInvariants({ a: 2, b: 3 }, invariants)).toHaveLength(1);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

// $ref resolution and value canonicalization through evaluateInvariants —
// coverage that used to live in sdk-js before $ref moved out of mongrule.
describe("$ref resolution through evaluateInvariants", () => {
  const inv = (rule: unknown): ConfigInvariant[] => [
    { name: "r", rule: JSON.stringify(rule), message: "violated" },
  ];

  it("resolves a nested dot-path ref", () => {
    const rule = {
      "buffer.target_seconds": { $lte: { $ref: "buffer.max_seconds" } },
    };
    expect(
      evaluateInvariants(
        { buffer: { target_seconds: 5, max_seconds: 10 } },
        inv(rule),
      ),
    ).toEqual([]);
    expect(
      evaluateInvariants(
        { buffer: { target_seconds: 20, max_seconds: 10 } },
        inv(rule),
      ),
    ).toHaveLength(1);
  });

  it("resolves refs inside $or branches", () => {
    const rule = {
      $or: [
        { unlimited: { $eq: true } },
        { streams: { $lte: { $ref: "limits.max" } } },
      ],
    };
    expect(
      evaluateInvariants(
        { unlimited: false, streams: 2, limits: { max: 4 } },
        inv(rule),
      ),
    ).toEqual([]);
    expect(
      evaluateInvariants(
        { unlimited: true, streams: 9, limits: { max: 4 } },
        inv(rule),
      ),
    ).toEqual([]);
    expect(
      evaluateInvariants(
        { unlimited: false, streams: 9, limits: { max: 4 } },
        inv(rule),
      ),
    ).toHaveLength(1);
  });

  it("resolves a missing ref path to null instead of erroring", () => {
    const rule = { streams: { $lte: { $ref: "limits.max" } } };
    // 5 <= null is false — a violation, not a crash.
    expect(
      evaluateInvariants({ streams: 5, limits: {} }, inv(rule)),
    ).toHaveLength(1);
  });

  it("object equality is key-order-insensitive", () => {
    const rule = { cfg: { a: 1, b: [2, 3] } };
    expect(evaluateInvariants({ cfg: { b: [2, 3], a: 1 } }, inv(rule))).toEqual(
      [],
    );
    expect(
      evaluateInvariants({ cfg: { a: 1, b: [2, 4] } }, inv(rule)),
    ).toHaveLength(1);
  });

  it("write-time probe accepts a shorthand $ref rule without console noise", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const stored = apiInvariantsToStored([
        { name: "eq", rule: { b: { $ref: "a" } }, message: "b must equal a" },
      ]);
      expect(JSON.parse(stored[0].rule)).toEqual({ b: { $ref: "a" } });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
