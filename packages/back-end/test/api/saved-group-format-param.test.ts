import {
  getFeatureValidator,
  getFeatureV2Validator,
  listFeaturesValidator,
  postFeatureValidator,
  revertFeatureV2Validator,
  toggleFeatureValidator,
  updateFeatureV2Validator,
} from "shared/validators";

// One per operation shape, across both API versions.
const validators = {
  getFeature: getFeatureValidator,
  getFeatureV2: getFeatureV2Validator,
  listFeatures: listFeaturesValidator,
  postFeature: postFeatureValidator,
  toggleFeature: toggleFeatureValidator,
  updateFeatureV2: updateFeatureV2Validator,
  revertFeatureV2: revertFeatureV2Validator,
};

describe("savedGroupFormat query param", () => {
  it.each(Object.entries(validators))("%s accepts v1 and v2", (_name, v) => {
    expect(v.querySchema.safeParse({ savedGroupFormat: "v1" }).success).toBe(
      true,
    );
    expect(v.querySchema.safeParse({ savedGroupFormat: "v2" }).success).toBe(
      true,
    );
  });

  it.each(Object.entries(validators))(
    "%s rejects an unknown format",
    (_name, v) => {
      expect(v.querySchema.safeParse({ savedGroupFormat: "v3" }).success).toBe(
        false,
      );
      expect(
        v.querySchema.safeParse({ savedGroupFormat: "inline" }).success,
      ).toBe(false);
    },
  );

  it.each(Object.entries(validators))(
    "%s leaves the format unset when omitted, so the caller gets v1",
    (_name, v) => {
      const parsed = v.querySchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(
          (parsed.data as { savedGroupFormat?: string }).savedGroupFormat,
        ).toBeUndefined();
      }
    },
  );
});
