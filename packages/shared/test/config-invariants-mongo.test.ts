import {
  evaluateInvariants,
  invariantRuleFields,
  toCel,
  describeInvariantRule,
  celToMongo,
  jsonLogicToMongo,
  mongoToJsonLogic,
  ConfigInvariant,
} from "../src/util/config-schema/invariants";

// Contract for the mongrule-backed invariants engine. Each rule is a mongo
// condition (mongrule / evalCondition): a rule is SATISFIED when the condition
// matches the resolved value, a VIOLATION when it doesn't. Field-to-field
// comparisons use the `$ref` marker added to mongrule.
//
// The 6 StreamingPlan patterns, in mongo form:
const RULE_DEFS: { name: string; rule: unknown; message: string }[] = [
  // 1. implication: hdr_enabled → max_resolution == "4k"   (¬A ∨ B)
  {
    name: "hdr_requires_4k",
    rule: {
      $or: [
        { $not: { hdr_enabled: { $eq: true } } },
        { max_resolution: { $eq: "4k" } },
      ],
    },
    message: "HDR requires 4K resolution.",
  },
  // 2. chain leaf: dolby_vision_enabled → hdr_enabled
  {
    name: "dolby_requires_hdr",
    rule: {
      $or: [
        { $not: { dolby_vision_enabled: { $eq: true } } },
        { hdr_enabled: { $eq: true } },
      ],
    },
    message: "Dolby Vision requires HDR.",
  },
  // 3. both-or-neither: downloads ⇔ (max_offline_titles set)
  {
    name: "downloads_iff_limit",
    rule: {
      $or: [
        {
          $and: [
            { offline_downloads_enabled: { $eq: true } },
            { max_offline_titles: { $exists: true } },
          ],
        },
        {
          $nor: [
            { offline_downloads_enabled: { $eq: true } },
            { max_offline_titles: { $exists: true } },
          ],
        },
      ],
    },
    message: "Offline downloads and max offline titles must be set together.",
  },
  // 4. mutual exclusion: ¬(ad_supported ∧ skip_ads_enabled)
  {
    name: "ads_mutually_exclusive",
    rule: {
      $not: {
        $and: [
          { ad_supported: { $eq: true } },
          { skip_ads_enabled: { $eq: true } },
        ],
      },
    },
    message: "Ad-supported and skip-ads can't both be enabled.",
  },
  // 5. enum-dependent: billing_mode == "metered" → overage set
  {
    name: "metered_requires_overage",
    rule: {
      $or: [
        { $not: { billing_mode: { $eq: "metered" } } },
        { overage_rate_cents_per_gb: { $exists: true } },
      ],
    },
    message: "Metered billing requires an overage rate.",
  },
  // 6. field-to-field ordering via $ref
  {
    name: "streams_lte_devices",
    rule: {
      max_concurrent_streams: { $lte: { $ref: "max_registered_devices" } },
    },
    message: "Concurrent streams cannot exceed registered devices.",
  },
];

const RULES: ConfigInvariant[] = RULE_DEFS.map((r) => ({
  name: r.name,
  rule: JSON.stringify(r.rule),
  message: r.message,
}));

const valid: Record<string, unknown> = {
  plan_tier: "standard",
  max_resolution: "4k",
  hdr_enabled: true,
  dolby_vision_enabled: true,
  offline_downloads_enabled: true,
  max_offline_titles: 25,
  max_concurrent_streams: 2,
  max_registered_devices: 5,
  ad_supported: true,
  skip_ads_enabled: false,
  billing_mode: "flat",
  overage_rate_cents_per_gb: null,
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

  it("pattern 1 — implication (HDR requires 4K)", () => {
    expect(
      names({
        ...valid,
        hdr_enabled: true,
        max_resolution: "1080p",
        dolby_vision_enabled: false,
      }),
    ).toEqual(["hdr_requires_4k"]);
    expect(
      names({
        ...valid,
        hdr_enabled: false,
        dolby_vision_enabled: false,
        max_resolution: "1080p",
      }),
    ).toEqual([]);
  });

  it("pattern 2 — chain leaf (Dolby requires HDR)", () => {
    expect(
      names({
        ...valid,
        dolby_vision_enabled: true,
        hdr_enabled: false,
        max_resolution: "1080p",
      }),
    ).toContain("dolby_requires_hdr");
  });

  it("pattern 3 — both-or-neither (downloads ⇔ limit)", () => {
    expect(
      names({
        ...valid,
        offline_downloads_enabled: true,
        max_offline_titles: null,
      }),
    ).toContain("downloads_iff_limit");
    expect(
      names({
        ...valid,
        offline_downloads_enabled: false,
        max_offline_titles: 10,
      }),
    ).toContain("downloads_iff_limit");
    expect(
      names({
        ...valid,
        offline_downloads_enabled: false,
        max_offline_titles: null,
      }),
    ).not.toContain("downloads_iff_limit");
  });

  it("pattern 4 — at-most-one (ads)", () => {
    expect(
      names({ ...valid, ad_supported: true, skip_ads_enabled: true }),
    ).toContain("ads_mutually_exclusive");
    expect(
      names({ ...valid, ad_supported: true, skip_ads_enabled: false }),
    ).not.toContain("ads_mutually_exclusive");
  });

  it("pattern 5 — enum-dependent (metered requires overage)", () => {
    expect(
      names({
        ...valid,
        billing_mode: "metered",
        overage_rate_cents_per_gb: null,
      }),
    ).toContain("metered_requires_overage");
    expect(
      names({
        ...valid,
        billing_mode: "metered",
        overage_rate_cents_per_gb: 5,
      }),
    ).not.toContain("metered_requires_overage");
  });

  it("pattern 6 — field-to-field via $ref (streams ≤ devices)", () => {
    expect(
      names({ ...valid, max_concurrent_streams: 6, max_registered_devices: 5 }),
    ).toEqual(["streams_lte_devices"]);
    expect(
      names({ ...valid, max_concurrent_streams: 5, max_registered_devices: 5 }),
    ).not.toContain("streams_lte_devices");
  });

  it("returns the human message, not the rule", () => {
    expect(
      evaluateInvariants({ ...valid, max_concurrent_streams: 9 }, RULES),
    ).toEqual([
      {
        name: "streams_lte_devices",
        message: "Concurrent streams cannot exceed registered devices.",
      },
    ]);
  });

  it("treats a missing field as absent (sparse value)", () => {
    // downloads absent → not true → iff satisfied when titles also absent
    expect(
      names({ max_concurrent_streams: 1, max_registered_devices: 1 }),
    ).not.toContain("downloads_iff_limit");
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
    expect(fields({ max_resolution: { $eq: "4k" } })).toEqual([
      "max_resolution",
    ]);
  });

  it("collects both sides of a $ref comparison", () => {
    expect(
      fields({
        max_concurrent_streams: { $lte: { $ref: "max_registered_devices" } },
      }),
    ).toEqual(["max_concurrent_streams", "max_registered_devices"]);
  });

  it("recurses through $or / $and / $not", () => {
    expect(
      fields({
        $or: [
          { $not: { hdr_enabled: { $eq: true } } },
          { max_resolution: { $eq: "4k" } },
        ],
      }),
    ).toEqual(["hdr_enabled", "max_resolution"]);
  });

  it("returns [] for an unparseable rule", () => {
    expect(invariantRuleFields("{ not json")).toEqual([]);
  });
});

describe("format converters (mongo canonical, CEL/JSONLogic at the boundary)", () => {
  const IMPLICATION = {
    $or: [
      { $not: { hdr_enabled: { $eq: true } } },
      { max_resolution: { $eq: "4k" } },
    ],
  };
  const EXCLUSIVE = {
    $not: {
      $and: [
        { ad_supported: { $eq: true } },
        { skip_ads_enabled: { $eq: true } },
      ],
    },
  };
  const ORDERING = {
    max_concurrent_streams: { $lte: { $ref: "max_registered_devices" } },
  };

  it("toCel: mongo → CEL", () => {
    expect(toCel(JSON.stringify(IMPLICATION))).toBe(
      "!hdr_enabled || max_resolution == '4k'",
    );
    expect(toCel(JSON.stringify(EXCLUSIVE))).toBe(
      "!(ad_supported && skip_ads_enabled)",
    );
    expect(toCel(JSON.stringify(ORDERING))).toBe(
      "max_concurrent_streams <= max_registered_devices",
    );
  });

  it("describeInvariantRule: mongo → friendly", () => {
    expect(describeInvariantRule(JSON.stringify(IMPLICATION))).toBe(
      "IF hdr_enabled THEN max_resolution == '4k'",
    );
    expect(describeInvariantRule(JSON.stringify(ORDERING))).toBe(
      "max_concurrent_streams ≤ max_registered_devices",
    );
    expect(
      describeInvariantRule(
        JSON.stringify({ max_offline_titles: { $exists: true } }),
      ),
    ).toBe("max_offline_titles is set");
  });

  it("celToMongo: CEL → mongo", () => {
    expect(
      celToMongo("max_concurrent_streams <= max_registered_devices"),
    ).toEqual(ORDERING);
    expect(celToMongo("!hdr_enabled || max_resolution == '4k'")).toEqual(
      IMPLICATION,
    );
    expect(celToMongo("!(ad_supported && skip_ads_enabled)")).toEqual(
      EXCLUSIVE,
    );
  });

  it("jsonLogicToMongo: JSONLogic → mongo", () => {
    expect(
      jsonLogicToMongo({
        "<=": [
          { var: "max_concurrent_streams" },
          { var: "max_registered_devices" },
        ],
      }),
    ).toEqual(ORDERING);
    expect(
      jsonLogicToMongo({
        or: [
          { "!": { var: "hdr_enabled" } },
          { "==": [{ var: "max_resolution" }, "4k"] },
        ],
      }),
    ).toEqual(IMPLICATION);
  });

  it("mongoToJsonLogic: mongo → JSONLogic", () => {
    expect(mongoToJsonLogic(JSON.stringify(ORDERING))).toEqual({
      "<=": [
        { var: "max_concurrent_streams" },
        { var: "max_registered_devices" },
      ],
    });
  });

  it("round-trips CEL → mongo → CEL", () => {
    for (const cel of [
      "!hdr_enabled || max_resolution == '4k'",
      "max_concurrent_streams <= max_registered_devices",
      "!(ad_supported && skip_ads_enabled)",
      "billing_mode != 'metered' || overage != null",
    ]) {
      expect(toCel(JSON.stringify(celToMongo(cel)))).toBe(cel);
    }
  });

  it("uploaded CEL/JSONLogic evaluate the same once stored as mongo", () => {
    const fromCel = celToMongo(
      "max_concurrent_streams <= max_registered_devices",
    );
    const fromJl = jsonLogicToMongo({
      "<=": [
        { var: "max_concurrent_streams" },
        { var: "max_registered_devices" },
      ],
    });
    const rules = (rule: unknown): ConfigInvariant[] => [
      { name: "r", rule: JSON.stringify(rule), message: "streams too high" },
    ];
    const bad = { max_concurrent_streams: 6, max_registered_devices: 5 };
    const ok = { max_concurrent_streams: 2, max_registered_devices: 5 };
    expect(evaluateInvariants(bad, rules(fromCel))).toHaveLength(1);
    expect(evaluateInvariants(ok, rules(fromCel))).toHaveLength(0);
    expect(evaluateInvariants(bad, rules(fromJl))).toHaveLength(1);
  });
});
