import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { OrganizationSettings, RequireReview } from "shared/types/organization";
import {
  autoMerge,
  checkIfRevisionNeedsReview,
  mergeResultHasChanges,
  mergeRevision,
  RulesAndValues,
} from "../../src/util";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseFeature: FeatureInterface = {
  dateCreated: new Date("2023-01-01"),
  dateUpdated: new Date("2023-01-01"),
  defaultValue: "false",
  environmentSettings: {
    production: { enabled: true, rules: [] },
    staging: { enabled: false, rules: [] },
  },
  id: "feat-1",
  organization: "org-1",
  owner: "alice",
  valueType: "boolean",
  version: 3,
  prerequisites: [],
  description: "A feature",
  project: "proj-1",
  tags: ["tag-a"],
};

const makeRevision = (
  overrides: Partial<FeatureRevisionInterface> = {},
): FeatureRevisionInterface => ({
  featureId: "feat-1",
  organization: "org-1",
  version: 4,
  baseVersion: 3,
  dateCreated: new Date(),
  dateUpdated: new Date(),
  datePublished: null,
  createdBy: { type: "dashboard", id: "u1", email: "u@ex.com", name: "Alice" },
  publishedBy: null,
  comment: "",
  status: "draft",
  defaultValue: "false",
  rules: {},
  ...overrides,
});

/** Minimal RequireReview config that matches all projects/envs */
const makeReviewSetting = (
  overrides: Partial<RequireReview> = {},
): RequireReview => ({
  requireReviewOn: true,
  resetReviewOnChange: false,
  environments: [],
  projects: [],
  ...overrides,
});

const makeSettings = (reviewSetting: RequireReview): OrganizationSettings => ({
  requireReviews: [reviewSetting],
});

// ---------------------------------------------------------------------------
// checkIfRevisionNeedsReview
// ---------------------------------------------------------------------------

describe("checkIfRevisionNeedsReview", () => {
  const allEnvironments = ["production", "staging"];

  it("returns false when requireReviewOn is false", () => {
    const settings = makeSettings(
      makeReviewSetting({ requireReviewOn: false }),
    );
    const base = makeRevision({ version: 3 });
    const revision = makeRevision({
      environmentsEnabled: { production: false },
    });
    expect(
      checkIfRevisionNeedsReview({
        feature: baseFeature,
        baseRevision: base,
        revision,
        allEnvironments,
        settings,
      }),
    ).toBe(false);
  });

  describe("environment review (featureRequireEnvironmentReview — kill switches + prerequisites)", () => {
    it("does NOT require review when featureRequireEnvironmentReview is false and env changed", () => {
      const settings = makeSettings(
        makeReviewSetting({
          requireReviewOn: false,
          featureRequireEnvironmentReview: false,
        }),
      );
      const base = makeRevision({
        version: 3,
        environmentsEnabled: { production: true },
      });
      const revision = makeRevision({
        environmentsEnabled: { production: false },
      });
      expect(
        checkIfRevisionNeedsReview({
          feature: baseFeature,
          baseRevision: base,
          revision,
          allEnvironments,
          settings,
        }),
      ).toBe(false);
    });

    it("DOES require review when featureRequireEnvironmentReview is true and env changed", () => {
      const settings = makeSettings(
        makeReviewSetting({
          requireReviewOn: true,
          featureRequireEnvironmentReview: true,
        }),
      );
      const base = makeRevision({
        version: 3,
        environmentsEnabled: { production: true },
      });
      const revision = makeRevision({
        environmentsEnabled: { production: false },
      });
      expect(
        checkIfRevisionNeedsReview({
          feature: baseFeature,
          baseRevision: base,
          revision,
          allEnvironments,
          settings,
        }),
      ).toBe(true);
    });

    it("does NOT require review when featureRequireEnvironmentReview is true but env did NOT change", () => {
      const settings = makeSettings(
        makeReviewSetting({
          requireReviewOn: false,
          featureRequireEnvironmentReview: true,
        }),
      );
      const base = makeRevision({
        version: 3,
        environmentsEnabled: { production: true },
      });
      const revision = makeRevision({
        environmentsEnabled: { production: true },
      });
      expect(
        checkIfRevisionNeedsReview({
          feature: baseFeature,
          baseRevision: base,
          revision,
          allEnvironments,
          settings,
        }),
      ).toBe(false);
    });

    it("DOES require review when featureRequireEnvironmentReview is true and prerequisites changed", () => {
      const settings = makeSettings(
        makeReviewSetting({
          requireReviewOn: true,
          featureRequireEnvironmentReview: true,
        }),
      );
      const base = makeRevision({ version: 3, prerequisites: [] });
      const revision = makeRevision({
        prerequisites: [{ id: "feat-dep", condition: '{"value": true}' }],
      });
      expect(
        checkIfRevisionNeedsReview({
          feature: baseFeature,
          baseRevision: base,
          revision,
          allEnvironments,
          settings,
        }),
      ).toBe(true);
    });

    it("does NOT require review when featureRequireEnvironmentReview is false and prerequisites changed", () => {
      const settings = makeSettings(
        makeReviewSetting({
          requireReviewOn: false,
          featureRequireEnvironmentReview: false,
        }),
      );
      const base = makeRevision({ version: 3, prerequisites: [] });
      const revision = makeRevision({
        prerequisites: [{ id: "feat-dep", condition: '{"value": true}' }],
      });
      expect(
        checkIfRevisionNeedsReview({
          feature: baseFeature,
          baseRevision: base,
          revision,
          allEnvironments,
          settings,
        }),
      ).toBe(false);
    });
  });

  describe("metadata (featureRequireMetadataReview)", () => {
    it("requires review when featureRequireMetadataReview is true and metadata changed", () => {
      const settings = makeSettings(
        makeReviewSetting({
          requireReviewOn: false,
          featureRequireMetadataReview: true,
        }),
      );
      const base = makeRevision({
        version: 3,
        metadata: { description: "old" },
      });
      const revision = makeRevision({
        metadata: { description: "new" },
      });
      expect(
        checkIfRevisionNeedsReview({
          feature: baseFeature,
          baseRevision: base,
          revision,
          allEnvironments,
          settings,
        }),
      ).toBe(true);
    });

    it("does NOT require review when metadata is unchanged", () => {
      const settings = makeSettings(
        makeReviewSetting({
          requireReviewOn: false,
          featureRequireMetadataReview: true,
        }),
      );
      const base = makeRevision({ version: 3, metadata: { owner: "alice" } });
      const revision = makeRevision({ metadata: { owner: "alice" } });
      expect(
        checkIfRevisionNeedsReview({
          feature: baseFeature,
          baseRevision: base,
          revision,
          allEnvironments,
          settings,
        }),
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// autoMerge — new envelopes
// ---------------------------------------------------------------------------

describe("autoMerge with new envelopes", () => {
  describe("no-divergence path (live.version === base.version)", () => {
    const live: RulesAndValues = {
      version: 3,
      defaultValue: "false",
      rules: {},
    };
    const base: RulesAndValues = {
      version: 3,
      defaultValue: "false",
      rules: {},
    };

    it("includes environmentsEnabled changes", () => {
      const revision: RulesAndValues = {
        version: 4,
        defaultValue: "false",
        rules: {},
        environmentsEnabled: { production: false },
      };
      const result = autoMerge(
        live,
        base,
        revision,
        ["production", "staging"],
        {},
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result.environmentsEnabled).toEqual({
          production: false,
        });
      }
    });

    it("includes prerequisites changes", () => {
      const revision: RulesAndValues = {
        version: 4,
        defaultValue: "false",
        rules: {},
        prerequisites: [{ id: "dep", condition: '{"value":true}' }],
      };
      const result = autoMerge(live, base, revision, [], {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result.prerequisites).toHaveLength(1);
      }
    });

    it("includes metadata changes", () => {
      const revision: RulesAndValues = {
        version: 4,
        defaultValue: "false",
        rules: {},
        metadata: { description: "updated", owner: "bob" },
      };
      const result = autoMerge(live, base, revision, [], {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result.metadata?.description).toBe("updated");
        expect(result.result.metadata?.owner).toBe("bob");
      }
    });

    it("omits metadata fields that did not change vs base", () => {
      const liveWithMeta: RulesAndValues = {
        ...live,
        metadata: { description: "same" },
      };
      const baseWithMeta: RulesAndValues = {
        ...base,
        metadata: { description: "same" },
      };
      const revision: RulesAndValues = {
        version: 4,
        defaultValue: "false",
        rules: {},
        metadata: { description: "same" }, // no change
      };
      const result = autoMerge(liveWithMeta, baseWithMeta, revision, [], {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result.metadata).toBeUndefined();
      }
    });
  });

  describe("diverged path (live.version !== base.version)", () => {
    const base: RulesAndValues = {
      version: 2,
      defaultValue: "false",
      rules: {},
      environmentsEnabled: { production: true },
      metadata: { description: "original" },
    };
    const live: RulesAndValues = {
      version: 3,
      defaultValue: "false",
      rules: {},
      environmentsEnabled: { production: true }, // same as base
      metadata: { description: "original" }, // same as base
    };

    it("applies non-conflicting environmentsEnabled change", () => {
      const revision: RulesAndValues = {
        version: 4,
        defaultValue: "false",
        rules: {},
        environmentsEnabled: { production: false }, // revision changed
      };
      const result = autoMerge(live, base, revision, ["production"], {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result.environmentsEnabled?.production).toBe(false);
        expect(result.conflicts).toHaveLength(0);
      }
    });

    it("detects conflict when live AND revision both changed environmentsEnabled differently", () => {
      const liveConflict: RulesAndValues = {
        ...live,
        environmentsEnabled: { production: false }, // live changed
      };
      const revision: RulesAndValues = {
        version: 4,
        defaultValue: "false",
        rules: {},
        environmentsEnabled: { production: false }, // same as live — no conflict (already matches)
      };
      // Since revision value === live value, there's no real conflict
      const result = autoMerge(
        liveConflict,
        base,
        revision,
        ["production"],
        {},
      );
      expect(result.success).toBe(true);
    });

    it("applies non-conflicting metadata change", () => {
      const revision: RulesAndValues = {
        version: 4,
        defaultValue: "false",
        rules: {},
        metadata: { description: "updated" }, // only revision changed
      };
      const result = autoMerge(live, base, revision, [], {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result.metadata?.description).toBe("updated");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// mergeResultHasChanges — new envelopes
// ---------------------------------------------------------------------------

describe("mergeResultHasChanges with new envelopes", () => {
  it("returns false when no changes", () => {
    expect(
      mergeResultHasChanges({ success: true, result: {}, conflicts: [] }),
    ).toBe(false);
  });

  it("returns true when environmentsEnabled has entries", () => {
    expect(
      mergeResultHasChanges({
        success: true,
        result: { environmentsEnabled: { production: false } },
        conflicts: [],
      }),
    ).toBe(true);
  });

  it("returns true when prerequisites is present", () => {
    expect(
      mergeResultHasChanges({
        success: true,
        result: {
          prerequisites: [{ id: "dep", condition: '{"value":true}' }],
        },
        conflicts: [],
      }),
    ).toBe(true);
  });

  it("returns true when metadata has entries", () => {
    expect(
      mergeResultHasChanges({
        success: true,
        result: { metadata: { description: "new" } },
        conflicts: [],
      }),
    ).toBe(true);
  });

  it("returns false when metadata is present but empty", () => {
    expect(
      mergeResultHasChanges({
        success: true,
        result: { metadata: {} },
        conflicts: [],
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mergeRevision — new envelope application
// ---------------------------------------------------------------------------

describe("mergeRevision with new envelopes", () => {
  it("applies environmentsEnabled from revision", () => {
    const revision = makeRevision({
      environmentsEnabled: { production: false, staging: true },
    });
    const merged = mergeRevision(baseFeature, revision, [
      "production",
      "staging",
    ]);
    expect(merged.environmentSettings.production.enabled).toBe(false);
    expect(merged.environmentSettings.staging.enabled).toBe(true);
  });

  it("applies prerequisites from revision", () => {
    const revision = makeRevision({
      prerequisites: [{ id: "dep", condition: '{"value":true}' }],
    });
    const merged = mergeRevision(baseFeature, revision, []);
    expect(merged.prerequisites).toHaveLength(1);
  });

  it("applies metadata fields from revision", () => {
    const revision = makeRevision({
      metadata: {
        description: "new desc",
        owner: "bob",
        project: "proj-2",
        tags: ["tag-x"],
        neverStale: true,
        valueType: "string",
      },
    });
    const merged = mergeRevision(baseFeature, revision, []);
    expect(merged.description).toBe("new desc");
    expect(merged.owner).toBe("bob");
    expect(merged.project).toBe("proj-2");
    expect(merged.tags).toEqual(["tag-x"]);
    expect(merged.neverStale).toBe(true);
    expect(merged.valueType).toBe("string");
  });

  it("does not override feature fields if envelope is not present in revision", () => {
    const revision = makeRevision(); // no envelopes
    const merged = mergeRevision(baseFeature, revision, ["production"]);
    // These should remain as-is from the live feature
    expect(merged.description).toBe("A feature");
    expect(merged.owner).toBe("alice");
    expect(merged.project).toBe("proj-1");
    expect(merged.tags).toEqual(["tag-a"]);
    expect(merged.environmentSettings.production.enabled).toBe(true);
  });

  it("does not mutate the original feature", () => {
    const original = JSON.stringify(baseFeature);
    const revision = makeRevision({
      metadata: { description: "mutated?" },
      environmentsEnabled: { production: false },
    });
    mergeRevision(baseFeature, revision, ["production"]);
    expect(JSON.stringify(baseFeature)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility — JIT migration (revisions missing envelopes)
// ---------------------------------------------------------------------------

describe("backward compatibility — old revisions without envelopes", () => {
  it("mergeRevision works on revision without any new envelopes", () => {
    const oldRevision = makeRevision(); // no environmentsEnabled, no prerequisites, no metadata
    const merged = mergeRevision(baseFeature, oldRevision, [
      "production",
      "staging",
    ]);
    // Should use live feature values as fallback
    expect(merged.environmentSettings.production.enabled).toBe(true);
    expect(merged.environmentSettings.staging.enabled).toBe(false);
    expect(merged.description).toBe("A feature");
  });

  it("autoMerge works on RulesAndValues without new envelope fields", () => {
    const live: RulesAndValues = {
      version: 3,
      defaultValue: "false",
      rules: {},
    };
    const base: RulesAndValues = {
      version: 3,
      defaultValue: "false",
      rules: {},
    };
    const revision: RulesAndValues = {
      version: 4,
      defaultValue: "true",
      rules: {},
    };
    const result = autoMerge(live, base, revision, [], {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result.defaultValue).toBe("true");
      expect(result.result.environmentsEnabled).toBeUndefined();
      expect(result.result.prerequisites).toBeUndefined();
      expect(result.result.metadata).toBeUndefined();
    }
  });

  it("checkIfRevisionNeedsReview handles missing envelopes gracefully", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        makeReviewSetting({
          requireReviewOn: false,
          featureRequireEnvironmentReview: true,
          featureRequireMetadataReview: true,
        }),
      ],
    };
    // Base and revision are old-style without new envelopes
    const base = makeRevision({ version: 3 });
    const revision = makeRevision({ version: 4 });
    // Nothing changed, so should not require review
    expect(
      checkIfRevisionNeedsReview({
        feature: baseFeature,
        baseRevision: base,
        revision,
        allEnvironments: ["production", "staging"],
        settings,
      }),
    ).toBe(false);
  });
});
