import { FeatureInterface } from "shared/types/feature";
import {
  featureMatchesSearch,
  featureMetadataEnvelope,
  normalizeMetadataValue,
} from "../../src/util/features";
import { metadataTouchesPayload } from "../../src/permissions/publishFootprint";

describe("featureMatchesSearch", () => {
  const flag = { id: "f_8k2j9x4p", label: "Express checkout button" };

  it("matches the key", () => {
    expect(featureMatchesSearch(flag, "8k2j")).toBe(true);
  });

  it("matches the label, ignoring case", () => {
    expect(featureMatchesSearch(flag, "CHECKOUT")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(featureMatchesSearch(flag, "onboarding")).toBe(false);
  });

  it("treats a blank search as matching everything", () => {
    expect(featureMatchesSearch(flag, "   ")).toBe(true);
  });

  it("works for flags without a label", () => {
    expect(featureMatchesSearch({ id: "dark-mode" }, "dark")).toBe(true);
    expect(featureMatchesSearch({ id: "dark-mode" }, "light")).toBe(false);
  });

  it("matches regex characters literally", () => {
    expect(featureMatchesSearch({ id: "team:checkout|v2" }, "t|v")).toBe(true);
    expect(featureMatchesSearch({ id: "abc" }, ".*")).toBe(false);
  });
});

describe("label metadata", () => {
  it("is never treated as changing the SDK payload", () => {
    expect(metadataTouchesPayload({ label: "Express checkout" })).toBe(false);
  });

  it("is snapshotted in the revision metadata envelope", () => {
    const feature = {
      id: "f_8k2j9x4p",
      label: "Express checkout",
    } as FeatureInterface;
    expect(featureMetadataEnvelope(feature).label).toBe("Express checkout");
    expect(featureMetadataEnvelope({ id: "x" } as FeatureInterface).label).toBe(
      "",
    );
  });
});

describe("label in drafts created before labels existed", () => {
  it("treats a missing label the same as an empty one", () => {
    // Old revision snapshots have no `label`; the live envelope reports "".
    expect(normalizeMetadataValue("label", undefined)).toEqual(
      normalizeMetadataValue("label", ""),
    );
  });
});
