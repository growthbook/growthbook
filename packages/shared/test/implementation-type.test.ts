import {
  canChangeImplementationType,
  implementationTypeAfterUnlink,
  deriveImplementationType,
  getImplementationType,
  hasImplementationLinkages,
} from "../src/util/implementation-type";

describe("deriveImplementationType", () => {
  it("is undefined with nothing linked", () => {
    expect(deriveImplementationType({})).toBeUndefined();
    expect(deriveImplementationType({ linkedFeatures: [] })).toBeUndefined();
  });

  it("names a single kind", () => {
    expect(deriveImplementationType({ linkedFeatures: ["f"] })).toBe("feature");
    expect(deriveImplementationType({ hasVisualChangesets: true })).toBe(
      "visual",
    );
    expect(deriveImplementationType({ hasURLRedirects: true })).toBe(
      "urlredirect",
    );
  });

  it("is multi with more than one kind", () => {
    expect(
      deriveImplementationType({
        linkedFeatures: ["f"],
        hasVisualChangesets: true,
      }),
    ).toBe("multi");
  });
});

describe("getImplementationType", () => {
  it("keeps values beside its one managed flag", () => {
    expect(
      getImplementationType({
        implementationType: "values",
        linkedFeatures: ["f"],
      }),
    ).toBe("values");
  });

  it("uses the stored value while nothing is linked", () => {
    expect(getImplementationType({ implementationType: "none" })).toBe("none");
    expect(getImplementationType({ implementationType: "visual" })).toBe(
      "visual",
    );
    expect(
      getImplementationType({ implementationType: "multi" }),
    ).toBeUndefined();
  });

  it("lets what is wired up override a stale stored value", () => {
    expect(
      getImplementationType({
        implementationType: "feature",
        hasVisualChangesets: true,
      }),
    ).toBe("visual");
    expect(
      getImplementationType({
        implementationType: "none",
        linkedFeatures: ["f"],
      }),
    ).toBe("feature");
    expect(
      getImplementationType({
        implementationType: "values",
        linkedFeatures: ["f"],
        hasURLRedirects: true,
      }),
    ).toBe("multi");
  });

  it("derives for legacy experiments", () => {
    expect(getImplementationType({ hasURLRedirects: true })).toBe(
      "urlredirect",
    );
  });
});

describe("canChangeImplementationType", () => {
  it("is free while nothing is linked", () => {
    expect(canChangeImplementationType({}, "visual")).toBe(true);
    expect(
      canChangeImplementationType({ implementationType: "values" }, "none"),
    ).toBe(true);
  });

  it("locks once a linkage exists", () => {
    const exp = { linkedFeatures: ["f"] };
    expect(hasImplementationLinkages(exp)).toBe(true);
    expect(canChangeImplementationType(exp, "visual")).toBe(false);
    expect(canChangeImplementationType(exp, "none")).toBe(false);
  });

  it("lets a legacy experiment adopt the label its linkages imply", () => {
    expect(
      canChangeImplementationType({ linkedFeatures: ["f"] }, "feature"),
    ).toBe(true);
  });
});

describe("implementationTypeAfterUnlink", () => {
  it("keeps the chosen kind once the last implementation is gone", () => {
    expect(
      implementationTypeAfterUnlink({
        implementationType: "feature",
        linkedFeatures: [],
      }),
    ).toBe("feature");
    expect(
      implementationTypeAfterUnlink({
        implementationType: "urlredirect",
        hasURLRedirects: false,
      }),
    ).toBe("urlredirect");
  });

  it("leaves a legacy mix undecided once nothing is linked", () => {
    expect(
      implementationTypeAfterUnlink({
        implementationType: "multi",
        hasVisualChangesets: false,
      }),
    ).toBeUndefined();
    expect(
      implementationTypeAfterUnlink({
        implementationType: "multi",
        linkedFeatures: ["f"],
      }),
    ).toBe("multi");
  });

  it("keeps a chosen kind that is still wired, or never was", () => {
    expect(
      implementationTypeAfterUnlink({
        implementationType: "feature",
        linkedFeatures: ["f"],
      }),
    ).toBe("feature");
    expect(
      implementationTypeAfterUnlink({ implementationType: "values" }),
    ).toBe("values");
    expect(implementationTypeAfterUnlink({})).toBeUndefined();
  });
});
