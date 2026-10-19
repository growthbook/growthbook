import { FeatureInterface } from "shared/types/feature";
import {
  featureKeyFromName,
  featureMatchesSearch,
  featureMetadataEnvelope,
  normalizeMetadataValue,
} from "../../src/util/features";
import { metadataTouchesPayload } from "../../src/permissions/publishFootprint";

describe("featureMatchesSearch", () => {
  const flag = { id: "f_8k2j9x4p", name: "Express checkout button" };

  it("matches the key", () => {
    expect(featureMatchesSearch(flag, "8k2j")).toBe(true);
  });

  it("matches the name, ignoring case", () => {
    expect(featureMatchesSearch(flag, "CHECKOUT")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(featureMatchesSearch(flag, "onboarding")).toBe(false);
  });

  it("treats a blank search as matching everything", () => {
    expect(featureMatchesSearch(flag, "   ")).toBe(true);
  });

  it("works for flags without a name", () => {
    expect(featureMatchesSearch({ id: "dark-mode" }, "dark")).toBe(true);
    expect(featureMatchesSearch({ id: "dark-mode" }, "light")).toBe(false);
  });

  it("matches regex characters literally", () => {
    expect(featureMatchesSearch({ id: "team:checkout|v2" }, "t|v")).toBe(true);
    expect(featureMatchesSearch({ id: "abc" }, ".*")).toBe(false);
  });
});

describe("name metadata", () => {
  it("is never treated as changing the SDK payload", () => {
    expect(metadataTouchesPayload({ name: "Express checkout" })).toBe(false);
  });

  it("is snapshotted in the revision metadata envelope", () => {
    const feature = {
      id: "f_8k2j9x4p",
      name: "Express checkout",
    } as FeatureInterface;
    expect(featureMetadataEnvelope(feature).name).toBe("Express checkout");
    expect(featureMetadataEnvelope({ id: "x" } as FeatureInterface).name).toBe(
      "",
    );
  });
});

describe("name in drafts created before names existed", () => {
  it("treats a missing name the same as an empty one", () => {
    // Old revision snapshots have no `name`; the live envelope reports "".
    expect(normalizeMetadataValue("name", undefined)).toEqual(
      normalizeMetadataValue("name", ""),
    );
  });
});

describe("featureKeyFromName", () => {
  it("turns a display name into a kebab-case key", () => {
    expect(featureKeyFromName("Express checkout button")).toBe(
      "express-checkout-button",
    );
  });

  it("drops characters keys can't contain", () => {
    expect(featureKeyFromName("  PAY-4821: Apple Pay / Google Pay!  ")).toBe(
      "pay-4821-apple-pay-google-pay",
    );
  });

  it("keeps keys short", () => {
    expect(featureKeyFromName("word ".repeat(40)).length).toBeLessThanOrEqual(
      64,
    );
  });

  it("returns an empty key for a name with no usable characters", () => {
    expect(featureKeyFromName("!!!")).toBe("");
  });
});
