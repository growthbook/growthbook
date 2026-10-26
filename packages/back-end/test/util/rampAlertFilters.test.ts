import {
  hasRampAlertFilters,
  rampMatchesAlertFilters,
  splitCsv,
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

describe("splitCsv", () => {
  it("trims values and drops empty ones", () => {
    expect(splitCsv(" checkout, ,payments,")).toEqual(["checkout", "payments"]);
  });
});

describe("hasRampAlertFilters", () => {
  it("is false for no filters, empty lists and empty custom fields", () => {
    expect(hasRampAlertFilters({})).toBe(false);
    expect(hasRampAlertFilters({ tag: [], customFields: {} })).toBe(false);
  });

  it("is true for any one filter", () => {
    expect(hasRampAlertFilters({ environment: ["production"] })).toBe(true);
    expect(hasRampAlertFilters({ customFields: { team: "growth" } })).toBe(
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
    const matches = (customFields: Record<string, string>) =>
      rampMatchesAlertFilters(ramp([checkout]), { customFields });

    expect(matches({ team: "growth" })).toBe(true);
    expect(matches({ team: "core,growth" })).toBe(true);
    expect(matches({ regions: "eu" })).toBe(true);
    expect(matches({ tier: "1" })).toBe(true);
    expect(matches({ team: "core" })).toBe(false);
    expect(matches({ owner: "growth" })).toBe(false);
  });
});
