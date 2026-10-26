import { rampAlertQueryValidator } from "shared/validators";
import {
  hasRampAlertFilters,
  rampMatchesAlertFilters,
} from "back-end/src/util/rampAlertFilters";

const checkout = {
  id: "checkout-v2",
  project: "prj_web",
  tags: ["checkout", "payments"],
  customFields: { team: "growth", regions: ["us", "eu"], tier: 1 },
};
const search = { id: "search-ranking", tags: ["search"] };

const ramp = (
  features: Parameters<typeof rampMatchesAlertFilters>[0]["features"],
  environments = ["production"],
) => ({ features, environments });

describe("rampAlertQueryValidator", () => {
  it("splits comma-separated and repeated values, dropping blanks", () => {
    expect(
      rampAlertQueryValidator.parse({
        tag: " checkout, ,payments,",
        environment: ["production", "staging,dev"],
        customFields: { team: "growth,core", owner: "" },
      }),
    ).toEqual({
      tag: ["checkout", "payments"],
      environment: ["production", "staging", "dev"],
      customFields: { team: ["growth", "core"], owner: [] },
    });
  });

  // A confirmed request replays the query saved after the first parse.
  it("parses its own output the same way", () => {
    const parsed = rampAlertQueryValidator.parse({
      environment: "production",
      customFields: { team: "growth" },
      reason: "Datadog: checkout errors",
    });
    expect(rampAlertQueryValidator.parse(parsed)).toEqual(parsed);
  });

  it("refuses unknown parameters", () => {
    expect(
      rampAlertQueryValidator.safeParse({ tags: "checkout" }).success,
    ).toBe(false);
  });
});

describe("hasRampAlertFilters", () => {
  it("is false for no filters, empty lists and blank custom fields", () => {
    expect(hasRampAlertFilters({})).toBe(false);
    expect(hasRampAlertFilters({ tag: [], customFields: {} })).toBe(false);
    expect(hasRampAlertFilters({ customFields: { team: [] } })).toBe(false);
  });

  it("is true for any one filter", () => {
    expect(hasRampAlertFilters({ environment: ["production"] })).toBe(true);
    expect(hasRampAlertFilters({ customFields: { team: ["growth"] } })).toBe(
      true,
    );
  });
});

describe("rampMatchesAlertFilters", () => {
  it("matches every ramp with no filters", () => {
    expect(rampMatchesAlertFilters(ramp([search]), {})).toBe(true);
  });

  it("matches any value within a filter", () => {
    expect(
      rampMatchesAlertFilters(ramp([checkout]), {
        tag: ["search", "payments"],
      }),
    ).toBe(true);
    expect(rampMatchesAlertFilters(ramp([checkout]), { tag: ["search"] })).toBe(
      false,
    );
  });

  it("requires every filter to match", () => {
    expect(
      rampMatchesAlertFilters(ramp([checkout]), {
        tag: ["checkout"],
        project: ["prj_web"],
        feature: ["checkout-v2"],
      }),
    ).toBe(true);
    expect(
      rampMatchesAlertFilters(ramp([checkout]), {
        tag: ["checkout"],
        project: ["prj_mobile"],
      }),
    ).toBe(false);
  });

  it("never matches a project filter for a feature without a project", () => {
    expect(rampMatchesAlertFilters(ramp([search]), { project: [""] })).toBe(
      false,
    );
  });

  it("matches environments against the ramp's footprint", () => {
    expect(
      rampMatchesAlertFilters(ramp([checkout], ["staging", "production"]), {
        environment: ["production"],
      }),
    ).toBe(true);
    expect(
      rampMatchesAlertFilters(ramp([checkout], ["staging"]), {
        environment: ["production"],
      }),
    ).toBe(false);
  });

  it("matches when any feature the ramp controls matches", () => {
    expect(
      rampMatchesAlertFilters(ramp([search, checkout]), { tag: ["checkout"] }),
    ).toBe(true);
  });

  it("never matches a ramp whose features couldn't be read", () => {
    expect(rampMatchesAlertFilters(ramp([]), {})).toBe(false);
  });

  it("matches custom fields by value, including multi-select and numbers", () => {
    const matches = (customFields: Record<string, string[]>) =>
      rampMatchesAlertFilters(ramp([checkout]), { customFields });

    expect(matches({ team: ["growth"] })).toBe(true);
    expect(matches({ team: ["core", "growth"] })).toBe(true);
    expect(matches({ regions: ["eu"] })).toBe(true);
    expect(matches({ tier: ["1"] })).toBe(true);
    expect(matches({ team: ["core"] })).toBe(false);
    expect(matches({ owner: ["growth"] })).toBe(false);
  });
});
