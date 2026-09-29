import {
  canChangeImplementationType,
  implementationTypeAfterUnlink,
  deriveImplementationType,
  getImplementationType,
  hasImplementationLinkages,
} from "../src/util/implementation-type";
import { canEditDeliveryInPlace } from "../src/util";

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
    expect(implementationTypeAfterUnlink({})).toBeUndefined();
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
});

describe("canEditDeliveryInPlace", () => {
  const running = {
    status: "running" as const,
    hasVisualChangesets: false,
    hasURLRedirects: false,
    linkedFeatures: [] as string[],
  };

  it("sends a running experiment with any implementation through a release plan", () => {
    expect(
      canEditDeliveryInPlace({ ...running, linkedFeatures: ["flag"] }),
    ).toBe(false);
    expect(
      canEditDeliveryInPlace({ ...running, hasVisualChangesets: true }),
    ).toBe(false);
    expect(canEditDeliveryInPlace({ ...running, hasURLRedirects: true })).toBe(
      false,
    );
  });

  it("edits in place before launch, after stopping, and when analysis only", () => {
    expect(
      canEditDeliveryInPlace({
        ...running,
        status: "draft",
        linkedFeatures: ["flag"],
      }),
    ).toBe(true);
    expect(
      canEditDeliveryInPlace({
        ...running,
        status: "stopped",
        linkedFeatures: ["flag"],
      }),
    ).toBe(true);
    expect(canEditDeliveryInPlace(running)).toBe(true);
  });
});
