import {
  leafClausesFromContexts,
  conditionFromLeafClauses,
} from "../src/experiments/contextual-bandit-condition";
import { contextualBanditAttrCol } from "../src/experiments/contextual-bandit-columns";

describe("leafClausesFromContexts", () => {
  const order = ["country", "device"];

  it("returns [] for no contexts (catch-all leaf)", () => {
    expect(leafClausesFromContexts([], order)).toEqual([]);
  });

  it("emits a single-level `in` clause per attribute for one context", () => {
    expect(
      leafClausesFromContexts([{ country: "US", device: "mobile" }], order),
    ).toEqual([
      { attribute: "country", levels: ["US"], operator: "in" },
      { attribute: "device", levels: ["mobile"], operator: "in" },
    ]);
  });

  it("collapses a varying attribute into a multi-level `in` clause (sorted)", () => {
    expect(
      leafClausesFromContexts(
        [
          { country: "US", device: "mobile" },
          { country: "CA", device: "mobile" },
        ],
        order,
      ),
    ).toEqual([
      { attribute: "country", levels: ["CA", "US"], operator: "in" },
      { attribute: "device", levels: ["mobile"], operator: "in" },
    ]);
  });

  it("orders clauses by the supplied attribute order", () => {
    expect(
      leafClausesFromContexts([{ device: "mobile", country: "US" }], order).map(
        (c) => c.attribute,
      ),
    ).toEqual(["country", "device"]);
  });

  it("de-prefixes internal contextual-bandit attribute columns", () => {
    const col = contextualBanditAttrCol("country");
    expect(leafClausesFromContexts([{ [col]: "US" }], [col])).toEqual([
      { attribute: "country", levels: ["US"], operator: "in" },
    ]);
  });

  it("negates sibling values when the leaf owns the Combined catch-all bucket", () => {
    expect(
      leafClausesFromContexts(
        [{ country: "US" }, { country: "CA" }, { country: "Combined" }],
        order,
        [{ country: "FR" }, { country: "DE" }],
      ),
    ).toEqual([
      { attribute: "country", levels: ["DE", "FR"], operator: "not in" },
    ]);
  });

  // The following four tests exercise every placement of the "Combined"
  // catch-all bucket across a two-attribute (country, device) tree with multiple
  // device types and several sibling leaves. An attribute containing "Combined"
  // is emitted as `not in` (the complement of its siblings' claimed values).

  it("case 1: Combined in neither attribute emits plain `in` clauses for both", () => {
    expect(
      leafClausesFromContexts(
        [
          { country: "US", device: "mobile" },
          { country: "US", device: "desktop" },
          { country: "CA", device: "tablet" },
        ],
        order,
        // Siblings are irrelevant when the leaf owns no Combined bucket.
        [
          { country: "FR", device: "mobile" },
          { country: "DE", device: "desktop" },
        ],
      ),
    ).toEqual([
      { attribute: "country", levels: ["CA", "US"], operator: "in" },
      {
        attribute: "device",
        levels: ["desktop", "mobile", "tablet"],
        operator: "in",
      },
    ]);
  });

  it("case 2: Combined in country only negates sibling countries and keeps device as `in`", () => {
    expect(
      leafClausesFromContexts(
        [
          { country: "US", device: "mobile" },
          { country: "Combined", device: "desktop" },
          { country: "US", device: "tablet" },
        ],
        order,
        // Sibling contexts spanning several distinct leaves.
        [
          { country: "FR", device: "mobile" },
          { country: "DE", device: "desktop" },
          { country: "CA", device: "tablet" },
          { country: "JP", device: "mobile" },
        ],
      ),
    ).toEqual([
      {
        attribute: "country",
        levels: ["CA", "DE", "FR", "JP"],
        operator: "not in",
      },
      {
        attribute: "device",
        levels: ["desktop", "mobile", "tablet"],
        operator: "in",
      },
    ]);
  });

  it("case 3: Combined in device only negates sibling devices and keeps country as `in`", () => {
    expect(
      leafClausesFromContexts(
        [
          { country: "US", device: "mobile" },
          { country: "CA", device: "Combined" },
          { country: "US", device: "mobile" },
        ],
        order,
        [
          { country: "FR", device: "desktop" },
          { country: "DE", device: "tablet" },
          { country: "CA", device: "tv" },
        ],
      ),
    ).toEqual([
      { attribute: "country", levels: ["CA", "US"], operator: "in" },
      {
        attribute: "device",
        levels: ["desktop", "tablet", "tv"],
        operator: "not in",
      },
    ]);
  });

  it("case 4: Combined in both attributes negates siblings for each", () => {
    expect(
      leafClausesFromContexts(
        [
          { country: "US", device: "mobile" },
          { country: "Combined", device: "Combined" },
        ],
        order,
        [
          { country: "FR", device: "desktop" },
          { country: "DE", device: "tablet" },
          { country: "CA", device: "desktop" },
        ],
      ),
    ).toEqual([
      {
        attribute: "country",
        levels: ["CA", "DE", "FR"],
        operator: "not in",
      },
      {
        attribute: "device",
        levels: ["desktop", "tablet"],
        operator: "not in",
      },
    ]);
  });

  it("drops the attribute when Combined has no sibling levels to exclude", () => {
    expect(
      leafClausesFromContexts(
        [{ country: "US" }, { country: "Combined" }],
        order,
        [],
      ),
    ).toEqual([]);
  });

  it("is deterministic regardless of input context order", () => {
    const a = leafClausesFromContexts(
      [
        { country: "US", device: "mobile" },
        { country: "CA", device: "mobile" },
      ],
      order,
    );
    const b = leafClausesFromContexts(
      [
        { country: "CA", device: "mobile" },
        { country: "US", device: "mobile" },
      ],
      order,
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  // The `attributes` argument is the set of attributes the tree split on along
  // the leaf's path, so the condition reflects tree logic (not the leaf's
  // observed groupings). This is the "top split Country=US, device never split"
  // case: the US leaf spans several observed devices, but device must NOT appear
  // in the condition, so a US user on an unobserved device still matches.
  describe("split-attribute restriction", () => {
    it("omits an attribute the tree never split on, even though it is observed", () => {
      expect(
        leafClausesFromContexts(
          [
            { country: "US", device: "mobile" },
            { country: "US", device: "desktop" },
          ],
          ["country"],
          [
            { country: "CA", device: "mobile" },
            { country: "FR", device: "tablet" },
          ],
        ),
      ).toEqual([{ attribute: "country", levels: ["US"], operator: "in" }]);
    });

    it("keeps every split attribute when both are on the path", () => {
      expect(
        leafClausesFromContexts(
          [{ country: "US", device: "mobile" }],
          ["country", "device"],
          [{ country: "CA", device: "desktop" }],
        ),
      ).toEqual([
        { attribute: "country", levels: ["US"], operator: "in" },
        { attribute: "device", levels: ["mobile"], operator: "in" },
      ]);
    });

    it("emits no clauses for a never-split (single-leaf) tree", () => {
      expect(
        leafClausesFromContexts(
          [
            { country: "US", device: "mobile" },
            { country: "CA", device: "desktop" },
          ],
          [],
          [],
        ),
      ).toEqual([]);
    });

    it("still negates siblings for a Combined bucket on a split attribute", () => {
      expect(
        leafClausesFromContexts(
          [
            { country: "Combined", device: "mobile" },
            { country: "US", device: "desktop" },
          ],
          ["country"],
          [
            { country: "FR", device: "mobile" },
            { country: "DE", device: "desktop" },
          ],
        ),
      ).toEqual([
        { attribute: "country", levels: ["DE", "FR"], operator: "not in" },
      ]);
    });
  });
});

describe("conditionFromLeafClauses", () => {
  it("returns {} for no clauses", () => {
    expect(conditionFromLeafClauses([])).toEqual({});
  });

  it("collapses single-level clauses to a bare value / $ne", () => {
    expect(
      conditionFromLeafClauses([
        { attribute: "country", levels: ["US"], operator: "in" },
        { attribute: "device", levels: ["mobile"], operator: "not in" },
      ]),
    ).toEqual({ country: "US", device: { $ne: "mobile" } });
  });

  it("uses $in / $nin for multi-level clauses", () => {
    expect(
      conditionFromLeafClauses([
        { attribute: "country", levels: ["CA", "US"], operator: "in" },
        {
          attribute: "browser",
          levels: ["Chrome", "Firefox"],
          operator: "not in",
        },
      ]),
    ).toEqual({
      country: { $in: ["CA", "US"] },
      browser: { $nin: ["Chrome", "Firefox"] },
    });
  });
});
