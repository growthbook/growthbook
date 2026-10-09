import {
  matchConfirmRules,
  routeConfirmation,
} from "../src/util/confirmations";

const publishProd = {
  action: "feature.publish" as const,
  environments: ["production"],
};
const startAnywhere = { action: "experiment.start" as const, environments: [] };

describe("matchConfirmRules", () => {
  it("matches a label, or its category, in an overlapping environment", () => {
    expect(
      matchConfirmRules([{ actions: ["feature.publish"] }], [publishProd]),
    ).toEqual([publishProd]);
    expect(
      matchConfirmRules([{ actions: ["feature.*"] }], [publishProd]),
    ).toEqual([publishProd]);
    expect(
      matchConfirmRules([{ actions: ["*"] }], [publishProd, startAnywhere]),
    ).toEqual([publishProd, startAnywhere]);
    expect(
      matchConfirmRules(
        [{ actions: ["feature.publish"], environments: ["staging"] }],
        [publishProd],
      ),
    ).toEqual([]);
  });

  it("matches an action with no environments against any environment list", () => {
    expect(
      matchConfirmRules(
        [{ actions: ["experiment.start"], environments: ["production"] }],
        [startAnywhere, publishProd],
      ),
    ).toEqual([startAnywhere]);
  });

  it("holds nothing without a matching rule", () => {
    expect(matchConfirmRules([], [publishProd])).toEqual([]);
    expect(
      matchConfirmRules([{ actions: ["feature"] }], [publishProd]),
    ).toEqual([]);
  });
});

describe("routeConfirmation", () => {
  it("holds an undeclared write to a live model as its catch-all", () => {
    expect(routeConfirmation("post", ["configs"], undefined)).toEqual([
      "config.other",
    ]);
    expect(routeConfirmation("post", ["configs"], [])).toEqual([]);
    expect(routeConfirmation("get", ["configs"], undefined)).toEqual([]);
    expect(routeConfirmation("post", ["metrics"], undefined)).toEqual([]);
  });
});
