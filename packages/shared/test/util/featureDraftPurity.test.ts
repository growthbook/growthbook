import { FeatureRevisionInterface } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import {
  isPureFeatureArchive,
  isPureFeatureRevert,
} from "../../src/util/featureDraftPurity";

// Live feature: drifted away from the target on defaultValue and rules, and it
// carries prerequisites the sparse target revision never recorded.
const feature = {
  organization: "org",
  id: "feat",
  defaultValue: "live",
  rules: [{ id: "r-live", type: "force" }],
  prerequisites: [{ id: "other", condition: "{}" }],
  archived: false,
  description: "live desc",
  owner: "o",
  project: "",
  tags: [],
  neverStale: false,
  customFields: {},
  valueType: "string",
  environmentSettings: { production: { enabled: true } },
} as unknown as FeatureInterface;

const liveMetadata = {
  description: "live desc",
  owner: "o",
  project: "",
  tags: [],
  neverStale: false,
  customFields: {},
  jsonSchema: undefined,
  valueType: "string",
  baseConfig: null,
};

// Target: a published revision we want to roll back to. Sparse — it never
// recorded prerequisites/archived/metadata/holdout.
const target = {
  version: 3,
  status: "published",
  defaultValue: "old",
  rules: [{ id: "r-old", type: "force" }],
} as unknown as FeatureRevisionInterface;

const draft = (overrides: Partial<FeatureRevisionInterface>) =>
  ({
    version: 9,
    status: "draft",
    revertedFromVersion: 3,
    // What createRevision produces for a revert to `target`: restored content,
    // with the envelopes the sparse target lacks filled from the live feature.
    defaultValue: "old",
    rules: [{ id: "r-old", type: "force" }],
    prerequisites: feature.prerequisites,
    archived: false,
    metadata: liveMetadata,
    environmentsEnabled: { production: true },
    ...overrides,
  }) as unknown as FeatureRevisionInterface;

describe("isPureFeatureRevert", () => {
  it("accepts a revert draft to a sparse target (envelopes filled from live)", () => {
    expect(isPureFeatureRevert({ feature, draft: draft({}), target })).toBe(
      true,
    );
  });

  it("rejects an edited restored value", () => {
    expect(
      isPureFeatureRevert({
        feature,
        draft: draft({ defaultValue: "something-new" }),
        target,
      }),
    ).toBe(false);
  });

  it("rejects an edited rule slipped in alongside the revert", () => {
    expect(
      isPureFeatureRevert({
        feature,
        draft: draft({
          rules: [{ id: "r-old", type: "force" }, { id: "r-new" }],
        } as unknown as Partial<FeatureRevisionInterface>),
        target,
      }),
    ).toBe(false);
  });

  it("rejects edited metadata", () => {
    expect(
      isPureFeatureRevert({
        feature,
        draft: draft({
          metadata: { ...liveMetadata, description: "sneaky" },
        } as unknown as Partial<FeatureRevisionInterface>),
        target,
      }),
    ).toBe(false);
  });

  it("rejects rampActions, which have publish-time side effects", () => {
    expect(
      isPureFeatureRevert({
        feature,
        draft: draft({
          rampActions: [{ type: "create" }],
        } as unknown as Partial<FeatureRevisionInterface>),
        target,
      }),
    ).toBe(false);
  });

  it("rejects a holdout change (membership side effect)", () => {
    expect(
      isPureFeatureRevert({
        feature,
        draft: draft({
          holdout: { id: "h1", value: "on" },
        } as unknown as Partial<FeatureRevisionInterface>),
        target,
      }),
    ).toBe(false);
  });

  it("rejects even RESTORING the target's holdout — the side effect still fires", () => {
    const withHoldout = {
      ...feature,
      holdout: { id: "h-live", value: "on" },
    } as unknown as FeatureInterface;
    const targetWithHoldout = {
      ...target,
      holdout: { id: "h-old", value: "off" },
    } as unknown as FeatureRevisionInterface;

    expect(
      isPureFeatureRevert({
        feature: withHoldout,
        // A faithful revert would put back the target's holdout...
        draft: draft({
          holdout: { id: "h-old", value: "off" },
        } as unknown as Partial<FeatureRevisionInterface>),
        target: targetWithHoldout,
      }),
    ).toBe(false);

    // ...while leaving it untouched stays publishable under revert authority.
    expect(
      isPureFeatureRevert({
        feature: withHoldout,
        draft: draft({
          holdout: { id: "h-live", value: "on" },
        } as unknown as Partial<FeatureRevisionInterface>),
        target: targetWithHoldout,
      }),
    ).toBe(true);
  });

  it("rejects a draft with no revert provenance", () => {
    expect(
      isPureFeatureRevert({
        feature,
        draft: draft({ revertedFromVersion: undefined }),
        target,
      }),
    ).toBe(false);
  });

  it("rejects provenance pointing at a different revision", () => {
    expect(
      isPureFeatureRevert({
        feature,
        draft: draft({ revertedFromVersion: 7 }),
        target,
      }),
    ).toBe(false);
  });

  it("accepts a field left at its live value (a no-op for that field)", () => {
    expect(
      isPureFeatureRevert({
        feature,
        draft: draft({ defaultValue: "live" }),
        target,
      }),
    ).toBe(true);
  });

  // createRevision writes an entry for EVERY environment it is handed,
  // defaulting absent ones to false — and the env list differs per caller. A
  // whole-object comparison rejected those filled-in keys as edits, so a faithful
  // revert never qualified.
  it("accepts filled-in environment keys the target never recorded", () => {
    expect(
      isPureFeatureRevert({
        feature,
        draft: draft({
          environmentsEnabled: { production: true, staging: false },
        }),
        // target only ever recorded production
        target: {
          ...target,
          environmentsEnabled: { production: true },
        } as unknown as FeatureRevisionInterface,
      }),
    ).toBe(true);
  });

  it("still rejects a filled-in key that disagrees with live", () => {
    expect(
      isPureFeatureRevert({
        feature,
        draft: draft({
          // live production is enabled, and the target never recorded staging
          environmentsEnabled: { production: true, staging: true },
        }),
        target: {
          ...target,
          environmentsEnabled: { production: true },
        } as unknown as FeatureRevisionInterface,
      }),
    ).toBe(false);
  });

  it("rejects an environment toggle that matches neither target nor live", () => {
    expect(
      isPureFeatureRevert({
        feature,
        draft: draft({ environmentsEnabled: { production: false } }),
        target,
      }),
    ).toBe(false);
  });

  it("accepts a draft that records no metadata at all (inherits live)", () => {
    expect(
      isPureFeatureRevert({
        feature,
        draft: draft({ metadata: undefined }),
        target,
      }),
    ).toBe(true);
  });

  it("accepts metadata that only spells an absent value differently", () => {
    expect(
      isPureFeatureRevert({
        feature,
        draft: draft({
          metadata: { description: "live desc", tags: undefined },
        } as unknown as Partial<FeatureRevisionInterface>),
        target,
      }),
    ).toBe(true);
  });
});

// Archive drafts touch nothing but `archived`, so the live feature is the only
// baseline. Reuses the drifted `feature` above.
const archiveDraft = (overrides: Partial<FeatureRevisionInterface>) =>
  ({
    version: 9,
    status: "draft",
    archived: true,
    defaultValue: feature.defaultValue,
    rules: feature.rules,
    prerequisites: feature.prerequisites,
    environmentsEnabled: { production: true },
    ...overrides,
  }) as unknown as FeatureRevisionInterface;

describe("isPureFeatureArchive", () => {
  it("accepts an archive draft that records no metadata", () => {
    expect(isPureFeatureArchive({ feature, draft: archiveDraft({}) })).toBe(
      true,
    );
  });

  it("accepts an archive draft carrying live's metadata envelope", () => {
    expect(
      isPureFeatureArchive({
        feature,
        draft: archiveDraft({
          metadata: liveMetadata,
        } as unknown as Partial<FeatureRevisionInterface>),
      }),
    ).toBe(true);
  });

  it("accepts an archive draft that omits the inherited envelopes", () => {
    expect(
      isPureFeatureArchive({
        feature,
        draft: archiveDraft({ prerequisites: undefined }),
      }),
    ).toBe(true);
  });

  it("rejects an archive draft that also edits metadata", () => {
    expect(
      isPureFeatureArchive({
        feature,
        draft: archiveDraft({
          metadata: { ...liveMetadata, description: "sneaky" },
        } as unknown as Partial<FeatureRevisionInterface>),
      }),
    ).toBe(false);
  });

  it("rejects an archive draft that also edits a rule", () => {
    expect(
      isPureFeatureArchive({
        feature,
        draft: archiveDraft({
          rules: [{ id: "r-live", type: "force" }, { id: "r-new" }],
        } as unknown as Partial<FeatureRevisionInterface>),
      }),
    ).toBe(false);
  });

  it("rejects an archive draft that also flips an environment", () => {
    expect(
      isPureFeatureArchive({
        feature,
        draft: archiveDraft({ environmentsEnabled: { production: false } }),
      }),
    ).toBe(false);
  });

  it("rejects a draft on an already-archived feature", () => {
    expect(
      isPureFeatureArchive({
        feature: { ...feature, archived: true } as FeatureInterface,
        draft: archiveDraft({}),
      }),
    ).toBe(false);
  });
});
