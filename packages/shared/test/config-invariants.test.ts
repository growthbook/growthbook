import {
  evaluateInvariants,
  describeInvariantRule,
  invariantRuleFields,
  toCel,
  celToJsonLogic,
  ConfigInvariant,
} from "../src/util/config-schema/invariants";

// One invariant per pattern from the StreamingPlan spec. Authored as JSONLogic
// objects for readability, then stringified (rules are stored as JSON strings).
const RULE_DEFS: { name: string; rule: unknown; message: string }[] = [
  {
    name: "hdr_requires_4k",
    rule: {
      or: [
        { "!": { var: "hdr_enabled" } },
        { "==": [{ var: "max_resolution" }, "4k"] },
      ],
    },
    message: "HDR requires 4K resolution.",
  },
  {
    name: "dolby_requires_hdr",
    rule: {
      or: [{ "!": { var: "dolby_vision_enabled" } }, { var: "hdr_enabled" }],
    },
    message: "Dolby Vision requires HDR.",
  },
  {
    name: "downloads_iff_limit",
    rule: {
      "==": [
        { var: "offline_downloads_enabled" },
        { "!=": [{ var: "max_offline_titles" }, null] },
      ],
    },
    message: "Offline downloads and max offline titles must be set together.",
  },
  {
    name: "ads_mutually_exclusive",
    rule: {
      "!": { and: [{ var: "ad_supported" }, { var: "skip_ads_enabled" }] },
    },
    message: "Ad-supported and skip-ads can't both be enabled.",
  },
  {
    name: "metered_requires_overage",
    rule: {
      or: [
        { "!=": [{ var: "billing_mode" }, "metered"] },
        { "!=": [{ var: "overage_rate_cents_per_gb" }, null] },
      ],
    },
    message: "Metered billing requires an overage rate.",
  },
  {
    name: "streams_lte_devices",
    rule: {
      "<=": [
        { var: "max_concurrent_streams" },
        { var: "max_registered_devices" },
      ],
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

describe("evaluateInvariants", () => {
  it("returns no violations for a fully-valid value", () => {
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

  it("pattern 6 — numeric ordering, field-to-field (streams ≤ devices)", () => {
    expect(
      names({ ...valid, max_concurrent_streams: 6, max_registered_devices: 5 }),
    ).toEqual(["streams_lte_devices"]);
    expect(
      names({ ...valid, max_concurrent_streams: 5, max_registered_devices: 5 }),
    ).not.toContain("streams_lte_devices");
  });

  it("returns the human message, not the rule", () => {
    const v = evaluateInvariants(
      { ...valid, max_concurrent_streams: 9 },
      RULES,
    );
    expect(v).toEqual([
      {
        name: "streams_lte_devices",
        message: "Concurrent streams cannot exceed registered devices.",
      },
    ]);
  });

  it("treats a missing field as null (sparse value), per the != null pattern", () => {
    expect(names({ offline_downloads_enabled: false })).not.toContain(
      "downloads_iff_limit",
    );
    expect(names({ offline_downloads_enabled: true })).toContain(
      "downloads_iff_limit",
    );
  });

  it("surfaces a malformed rule (unknown op) as a violation instead of throwing", () => {
    const bad: ConfigInvariant[] = [
      {
        name: "bad_op",
        rule: JSON.stringify({ not_a_real_op: [1, 2] }),
        message: "bad op",
      },
    ];
    let result: ReturnType<typeof evaluateInvariants> = [];
    expect(() => {
      result = evaluateInvariants({}, bad);
    }).not.toThrow();
    expect(result.map((v) => v.name)).toEqual(["bad_op"]);
  });

  it("surfaces an unparseable rule string as a violation instead of throwing", () => {
    const bad: ConfigInvariant[] = [
      { name: "bad_json", rule: "{ not valid json", message: "bad json" },
    ];
    let result: ReturnType<typeof evaluateInvariants> = [];
    expect(() => {
      result = evaluateInvariants({}, bad);
    }).not.toThrow();
    expect(result.map((v) => v.name)).toEqual(["bad_json"]);
  });
});

describe("describeInvariantRule", () => {
  const rule = (r: unknown) => describeInvariantRule(JSON.stringify(r));

  it("renders a single comparison as infix", () => {
    expect(rule({ "==": [{ var: "hello" }, "4k"] })).toBe('hello == "4k"');
    expect(rule({ "!=": [{ var: "hello" }, "4k"] })).toBe('hello ≠ "4k"');
  });

  it("renders field-to-field ordering (pattern 6)", () => {
    expect(
      rule({
        "<=": [
          { var: "max_concurrent_streams" },
          { var: "max_registered_devices" },
        ],
      }),
    ).toBe("max_concurrent_streams ≤ max_registered_devices");
  });

  it("renders implication (pattern 1) as IF … THEN …", () => {
    expect(
      rule({
        or: [
          { "!": { var: "hdr_enabled" } },
          { "==": [{ var: "max_resolution" }, "4k"] },
        ],
      }),
    ).toBe('IF hdr_enabled THEN max_resolution == "4k"');
  });

  it("renders a grouped antecedent as IF (… AND …) THEN …", () => {
    expect(
      rule({
        or: [
          { "!": { and: [{ var: "a" }, { ">=": [{ var: "b" }, 3] }] } },
          { "==": [{ var: "c" }, "x"] },
        ],
      }),
    ).toBe('IF (a AND b ≥ 3) THEN c == "x"');
  });

  it("parenthesizes a nested boolean group (pattern 4)", () => {
    expect(
      rule({
        "!": { and: [{ var: "ad_supported" }, { var: "skip_ads_enabled" }] },
      }),
    ).toBe("NOT (ad_supported AND skip_ads_enabled)");
  });

  it("parenthesizes a nested comparison operand (both-or-neither, pattern 3)", () => {
    expect(
      rule({
        "==": [
          { var: "offline_downloads_enabled" },
          { "!=": [{ var: "max_offline_titles" }, null] },
        ],
      }),
    ).toBe("offline_downloads_enabled == (max_offline_titles ≠ null)");
  });

  it("falls back to the raw string for unparseable input", () => {
    expect(describeInvariantRule("{ not json")).toBe("{ not json");
  });
});

describe("invariantRuleFields", () => {
  const fields = (r: unknown) => invariantRuleFields(JSON.stringify(r)).sort();

  it("collects every referenced field key", () => {
    expect(fields({ "<=": [{ var: "a" }, { var: "b" }] })).toEqual(["a", "b"]);
    expect(
      fields({
        or: [{ "!": { var: "hdr" } }, { "==": [{ var: "res" }, "4k"] }],
      }),
    ).toEqual(["hdr", "res"]);
  });

  it("dedupes and uses the top-level path segment", () => {
    expect(
      fields({ and: [{ var: "a" }, { "==": [{ var: "a.b" }, 1] }] }),
    ).toEqual(["a"]);
  });

  it("returns [] for an unparseable rule", () => {
    expect(invariantRuleFields("{ not json")).toEqual([]);
  });
});

describe("toCel", () => {
  const cel = (r: unknown) => toCel(JSON.stringify(r));

  it("transpiles an implication (¬A ∨ B)", () => {
    expect(
      cel({
        or: [
          { "!": { var: "hdr_enabled" } },
          { "==": [{ var: "max_resolution" }, "4k"] },
        ],
      }),
    ).toBe("!hdr_enabled || max_resolution == '4k'");
  });

  it("transpiles mutual exclusion with parens", () => {
    expect(cel({ "!": { and: [{ var: "a" }, { var: "b" }] } })).toBe(
      "!(a && b)",
    );
  });

  it("transpiles field-to-field ordering", () => {
    expect(cel({ "<=": [{ var: "a" }, { var: "b" }] })).toBe("a <= b");
  });

  it("parenthesizes a nested comparison operand", () => {
    expect(cel({ "==": [{ var: "a" }, { "!=": [{ var: "b" }, null] }] })).toBe(
      "a == (b != null)",
    );
  });

  it("falls back to the raw string for unparseable input", () => {
    expect(toCel("{ not json")).toBe("{ not json");
  });
});

describe("celToJsonLogic", () => {
  it("parses comparisons and literals", () => {
    expect(celToJsonLogic("a <= b")).toEqual({
      "<=": [{ var: "a" }, { var: "b" }],
    });
    expect(celToJsonLogic('max_resolution == "4k"')).toEqual({
      "==": [{ var: "max_resolution" }, "4k"],
    });
    expect(celToJsonLogic("a != null")).toEqual({
      "!=": [{ var: "a" }, null],
    });
    expect(celToJsonLogic("a == 5")).toEqual({ "==": [{ var: "a" }, 5] });
    expect(celToJsonLogic("a == true")).toEqual({ "==": [{ var: "a" }, true] });
  });

  it("parses implication and mutual exclusion", () => {
    expect(celToJsonLogic('!hdr_enabled || max_resolution == "4k"')).toEqual({
      or: [
        { "!": { var: "hdr_enabled" } },
        { "==": [{ var: "max_resolution" }, "4k"] },
      ],
    });
    expect(celToJsonLogic("!(a && b)")).toEqual({
      "!": { and: [{ var: "a" }, { var: "b" }] },
    });
  });

  it("round-trips CEL → JSONLogic → CEL", () => {
    for (const cel of [
      "!hdr_enabled || max_resolution == '4k'",
      "max_concurrent_streams <= max_registered_devices",
      "!(ad_supported && skip_ads_enabled)",
      "billing_mode != 'metered' || overage != null",
    ]) {
      expect(toCel(JSON.stringify(celToJsonLogic(cel)))).toBe(cel);
    }
  });

  it("throws on malformed input", () => {
    expect(() => celToJsonLogic("a &&")).toThrow();
    expect(() => celToJsonLogic("a b c")).toThrow();
    expect(() => celToJsonLogic("(a || b")).toThrow();
  });
});
