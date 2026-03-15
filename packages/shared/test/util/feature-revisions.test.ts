import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { OrganizationSettings, RequireReview } from "shared/types/organization";
import {
  autoMerge,
  checkIfRevisionNeedsReview,
  fillRevisionFromFeature,
  getDraftAffectedEnvironments,
  mergeResultHasChanges,
  mergeRevision,
  RevisionFields,
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
          requireReviewOn: true,
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
          requireReviewOn: true,
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

  describe("environment scoping (gatedEnvs non-empty)", () => {
    // Review rule only covers "production"; changes to "dev" should never trigger it.
    const allEnvs = ["production", "dev"];

    it("does NOT require review for rule change localized to non-gated env (dev)", () => {
      const settings = makeSettings(
        makeReviewSetting({
          requireReviewOn: true,
          environments: ["production"],
        }),
      );
      const base = makeRevision({ version: 3, rules: { dev: [] } });
      const revision = makeRevision({
        rules: {
          dev: [
            {
              id: "r1",
              type: "force",
              value: "true",
              enabled: true,
              condition: "",
            },
          ],
        },
      });
      expect(
        checkIfRevisionNeedsReview({
          feature: baseFeature,
          baseRevision: base,
          revision,
          allEnvironments: allEnvs,
          settings,
        }),
      ).toBe(false);
    });

    it("DOES require review for rule change touching gated env (production)", () => {
      const settings = makeSettings(
        makeReviewSetting({
          requireReviewOn: true,
          environments: ["production"],
        }),
      );
      const base = makeRevision({ version: 3, rules: { production: [] } });
      const revision = makeRevision({
        rules: {
          production: [
            {
              id: "r1",
              type: "force",
              value: "true",
              enabled: true,
              condition: "",
            },
          ],
        },
      });
      expect(
        checkIfRevisionNeedsReview({
          feature: baseFeature,
          baseRevision: base,
          revision,
          allEnvironments: allEnvs,
          settings,
        }),
      ).toBe(true);
    });

    it("DOES require review when changes span both gated and non-gated envs", () => {
      const settings = makeSettings(
        makeReviewSetting({
          requireReviewOn: true,
          environments: ["production"],
        }),
      );
      const base = makeRevision({
        version: 3,
        rules: { production: [], dev: [] },
      });
      const revision = makeRevision({
        rules: {
          production: [
            {
              id: "r1",
              type: "force",
              value: "true",
              enabled: true,
              condition: "",
            },
          ],
          dev: [
            {
              id: "r2",
              type: "force",
              value: "true",
              enabled: true,
              condition: "",
            },
          ],
        },
      });
      expect(
        checkIfRevisionNeedsReview({
          feature: baseFeature,
          baseRevision: base,
          revision,
          allEnvironments: allEnvs,
          settings,
        }),
      ).toBe(true);
    });

    it("does NOT require review for kill-switch change on non-gated env", () => {
      const settings = makeSettings(
        makeReviewSetting({
          requireReviewOn: true,
          environments: ["production"],
          featureRequireEnvironmentReview: true,
        }),
      );
      const base = makeRevision({
        version: 3,
        environmentsEnabled: { dev: true },
      });
      const revision = makeRevision({ environmentsEnabled: { dev: false } });
      expect(
        checkIfRevisionNeedsReview({
          feature: baseFeature,
          baseRevision: base,
          revision,
          allEnvironments: allEnvs,
          settings,
        }),
      ).toBe(false);
    });

    it("DOES require review for kill-switch change on gated env", () => {
      const settings = makeSettings(
        makeReviewSetting({
          requireReviewOn: true,
          environments: ["production"],
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
          allEnvironments: allEnvs,
          settings,
        }),
      ).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// autoMerge — new envelopes
// ---------------------------------------------------------------------------

describe("autoMerge with new envelopes", () => {
  describe("no-divergence path (live.version === base.version)", () => {
    const live: RevisionFields = {
      version: 3,
      defaultValue: "false",
      rules: {},
    };
    const base: RevisionFields = {
      version: 3,
      defaultValue: "false",
      rules: {},
    };

    it("includes environmentsEnabled changes", () => {
      const revision: RevisionFields = {
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
      const revision: RevisionFields = {
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
      const revision: RevisionFields = {
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
      const liveWithMeta: RevisionFields = {
        ...live,
        metadata: { description: "same" },
      };
      const baseWithMeta: RevisionFields = {
        ...base,
        metadata: { description: "same" },
      };
      const revision: RevisionFields = {
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
    const base: RevisionFields = {
      version: 2,
      defaultValue: "false",
      rules: {},
      environmentsEnabled: { production: true },
      metadata: { description: "original" },
    };
    const live: RevisionFields = {
      version: 3,
      defaultValue: "false",
      rules: {},
      environmentsEnabled: { production: true }, // same as base
      metadata: { description: "original" }, // same as base
    };

    it("applies non-conflicting environmentsEnabled change", () => {
      const revision: RevisionFields = {
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
      const liveConflict: RevisionFields = {
        ...live,
        environmentsEnabled: { production: false }, // live changed
      };
      const revision: RevisionFields = {
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
      const revision: RevisionFields = {
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

  it("autoMerge works on RevisionFields without new envelope fields", () => {
    const live: RevisionFields = {
      version: 3,
      defaultValue: "false",
      rules: {},
    };
    const base: RevisionFields = {
      version: 3,
      defaultValue: "false",
      rules: {},
    };
    const revision: RevisionFields = {
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

// ---------------------------------------------------------------------------
// fillRevisionFromFeature
// ---------------------------------------------------------------------------

describe("fillRevisionFromFeature", () => {
  it("backfills environmentsEnabled for environments not present in revision", () => {
    const feature: FeatureInterface = {
      ...baseFeature,
      environmentSettings: {
        production: { enabled: true, rules: [] },
        staging: { enabled: false, rules: [] },
        canary: { enabled: true, rules: [] },
      },
    };
    const revision: RevisionFields = {
      version: 4,
      defaultValue: "false",
      rules: {},
      // revision only knows about production
      environmentsEnabled: { production: false },
    };
    const filled = fillRevisionFromFeature(revision, feature);
    // revision's explicit value wins
    expect(filled.environmentsEnabled?.production).toBe(false);
    // missing envs are back-filled from the live feature
    expect(filled.environmentsEnabled?.staging).toBe(false);
    expect(filled.environmentsEnabled?.canary).toBe(true);
  });

  it("does not mutate the original revision", () => {
    const feature: FeatureInterface = {
      ...baseFeature,
      environmentSettings: {
        production: { enabled: true, rules: [] },
      },
    };
    const revision: RevisionFields = {
      version: 4,
      defaultValue: "false",
      rules: {},
    };
    const original = JSON.stringify(revision);
    fillRevisionFromFeature(revision, feature);
    expect(JSON.stringify(revision)).toBe(original);
  });

  it("leaves fields without a filler untouched", () => {
    const revision: RevisionFields = {
      version: 4,
      defaultValue: "custom",
      rules: {
        production: [{ type: "force", id: "r1", description: "", value: "x" }],
      },
      metadata: { description: "keep me" },
    };
    const filled = fillRevisionFromFeature(revision, baseFeature);
    expect(filled.defaultValue).toBe("custom");
    expect(filled.metadata?.description).toBe("keep me");
    expect(filled.rules.production).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getDraftAffectedEnvironments
// ---------------------------------------------------------------------------

describe("getDraftAffectedEnvironments", () => {
  const base: RevisionFields = {
    version: 3,
    defaultValue: "false",
    rules: { production: [], staging: [] },
    environmentsEnabled: { production: true, staging: false },
    prerequisites: [],
  };

  it("returns [] when nothing changed", () => {
    const revision: RevisionFields = { ...base, version: 4 };
    expect(
      getDraftAffectedEnvironments(revision, base, ["production", "staging"]),
    ).toEqual([]);
  });

  it("returns specific envs when only rules for those envs changed", () => {
    const revision: RevisionFields = {
      ...base,
      version: 4,
      rules: {
        ...base.rules,
        production: [{ type: "force", id: "r1", description: "", value: "x" }],
      },
    };
    expect(
      getDraftAffectedEnvironments(revision, base, ["production", "staging"]),
    ).toEqual(["production"]);
  });

  it("returns specific env when only its kill switch changed", () => {
    const revision: RevisionFields = {
      ...base,
      version: 4,
      environmentsEnabled: { production: false }, // changed
    };
    expect(
      getDraftAffectedEnvironments(revision, base, ["production", "staging"]),
    ).toEqual(["production"]);
  });

  it('returns "all" for defaultValue change', () => {
    const revision: RevisionFields = {
      ...base,
      version: 4,
      defaultValue: "true",
    };
    expect(
      getDraftAffectedEnvironments(revision, base, ["production", "staging"]),
    ).toBe("all");
  });

  it('returns "all" for prerequisites change', () => {
    const revision: RevisionFields = {
      ...base,
      version: 4,
      prerequisites: [{ id: "dep", condition: '{"value":true}' }],
    };
    expect(
      getDraftAffectedEnvironments(revision, base, ["production", "staging"]),
    ).toBe("all");
  });

  it('returns "all" for archived change', () => {
    const revision: RevisionFields = {
      ...base,
      version: 4,
      archived: true,
    };
    expect(
      getDraftAffectedEnvironments(revision, base, ["production", "staging"]),
    ).toBe("all");
  });

  it('returns "all" for holdout add', () => {
    const revision: RevisionFields = {
      ...base,
      version: 4,
      holdout: { id: "holdout-1", value: "holdout" },
    };
    expect(
      getDraftAffectedEnvironments(revision, base, ["production", "staging"]),
    ).toBe("all");
  });

  it('returns "all" for holdout removal (null vs undefined)', () => {
    const baseWithHoldout: RevisionFields = {
      ...base,
      holdout: { id: "holdout-1", value: "holdout" },
    };
    const revision: RevisionFields = {
      ...base,
      version: 4,
      holdout: null,
    };
    expect(
      getDraftAffectedEnvironments(revision, baseWithHoldout, [
        "production",
        "staging",
      ]),
    ).toBe("all");
  });

  it('collapses to "all" when every environment is affected', () => {
    const revision: RevisionFields = {
      ...base,
      version: 4,
      rules: {
        production: [{ type: "force", id: "r1", description: "", value: "x" }],
        staging: [{ type: "force", id: "r2", description: "", value: "y" }],
      },
    };
    expect(
      getDraftAffectedEnvironments(revision, base, ["production", "staging"]),
    ).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// autoMerge — archived + holdout fields
// ---------------------------------------------------------------------------

describe("autoMerge with archived field", () => {
  const base: RevisionFields = {
    version: 3,
    defaultValue: "false",
    rules: {},
    archived: false,
  };
  const live: RevisionFields = { ...base };

  it("no-divergence: includes archived change", () => {
    const revision: RevisionFields = { ...base, version: 4, archived: true };
    const result = autoMerge(live, base, revision, [], {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.result.archived).toBe(true);
  });

  it("no-divergence: omits archived when unchanged", () => {
    const revision: RevisionFields = { ...base, version: 4, archived: false };
    const result = autoMerge(live, base, revision, [], {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.result.archived).toBeUndefined();
  });

  it("diverged: applies non-conflicting archived change when only revision changed it", () => {
    const divergedLive: RevisionFields = {
      ...live,
      version: 5,
    };
    const revision: RevisionFields = { ...base, version: 4, archived: true };
    const result = autoMerge(divergedLive, base, revision, [], {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.result.archived).toBe(true);
  });

  it("diverged: detects conflict when live and revision both changed archived differently", () => {
    const divergedLive: RevisionFields = {
      ...live,
      version: 5,
      archived: true, // live set it to true
    };
    const revision: RevisionFields = {
      ...base,
      version: 4,
      // archived stays false → same as base → no conflict (revision === base)
    };
    const result = autoMerge(divergedLive, base, revision, [], {});
    expect(result.success).toBe(true);
    expect(result.conflicts.some((c) => c.key === "archived")).toBe(false);
  });
});

describe("autoMerge with holdout field", () => {
  const holdout1 = { id: "h-1", value: "holdout" };
  const holdout2 = { id: "h-2", value: "holdout" };

  const base: RevisionFields = {
    version: 3,
    defaultValue: "false",
    rules: {},
  };
  const live: RevisionFields = { ...base };

  it("no-divergence: includes holdout add", () => {
    const revision: RevisionFields = { ...base, version: 4, holdout: holdout1 };
    const result = autoMerge(live, base, revision, [], {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.result.holdout).toEqual(holdout1);
  });

  it("no-divergence: includes holdout value-only change (same id, different value)", () => {
    const holdout1v2 = { id: "h-1", value: "updated-value" };
    const baseWithHoldout: RevisionFields = { ...base, holdout: holdout1 };
    const liveWithHoldout: RevisionFields = { ...live, holdout: holdout1 };
    const revision: RevisionFields = {
      ...base,
      version: 4,
      holdout: holdout1v2,
    };
    const result = autoMerge(
      liveWithHoldout,
      baseWithHoldout,
      revision,
      [],
      {},
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.result.holdout).toEqual(holdout1v2);
  });

  it("no-divergence: includes holdout removal (null)", () => {
    const baseWithHoldout: RevisionFields = { ...base, holdout: holdout1 };
    const liveWithHoldout: RevisionFields = { ...live, holdout: holdout1 };
    const revision: RevisionFields = { ...base, version: 4, holdout: null };
    const result = autoMerge(
      liveWithHoldout,
      baseWithHoldout,
      revision,
      [],
      {},
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.result.holdout).toBeNull();
  });

  it("no-divergence: omits holdout when absent from revision (field not set)", () => {
    const revision: RevisionFields = { ...base, version: 4 }; // no holdout key
    const result = autoMerge(live, base, revision, [], {});
    expect(result.success).toBe(true);
    if (result.success) expect("holdout" in result.result).toBe(false);
  });

  it("no-divergence: omits holdout when value unchanged (same id)", () => {
    const baseWithHoldout: RevisionFields = { ...base, holdout: holdout1 };
    const liveWithHoldout: RevisionFields = { ...live, holdout: holdout1 };
    const revision: RevisionFields = {
      ...base,
      version: 4,
      holdout: holdout1,
    };
    const result = autoMerge(
      liveWithHoldout,
      baseWithHoldout,
      revision,
      [],
      {},
    );
    expect(result.success).toBe(true);
    if (result.success) expect("holdout" in result.result).toBe(false);
  });

  it("diverged: detects conflict when live and revision both changed holdout to different values", () => {
    const divergedLive: RevisionFields = {
      ...live,
      version: 5,
      holdout: holdout2, // live picked a different holdout
    };
    const revision: RevisionFields = {
      ...base,
      version: 4,
      holdout: holdout1, // revision wants holdout1
    };
    const result = autoMerge(divergedLive, base, revision, [], {});
    expect(result.success).toBe(false);
    expect(result.conflicts.some((c) => c.key === "holdout")).toBe(true);
  });

  it("diverged: resolves holdout conflict with overwrite strategy", () => {
    const holdout2b = { id: "h-2", value: "holdout" };
    const divergedLive: RevisionFields = {
      ...live,
      version: 5,
      holdout: holdout2b,
    };
    const revision: RevisionFields = { ...base, version: 4, holdout: holdout1 };
    const result = autoMerge(divergedLive, base, revision, [], {
      holdout: "overwrite",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.result.holdout).toEqual(holdout1);
  });
});

// ---------------------------------------------------------------------------
// mergeResultHasChanges — archived + holdout
// ---------------------------------------------------------------------------

describe("mergeResultHasChanges — archived and holdout", () => {
  it("returns true when archived is present", () => {
    expect(
      mergeResultHasChanges({
        success: true,
        result: { archived: true },
        conflicts: [],
      }),
    ).toBe(true);
  });

  it("returns true when holdout is present (even null = removal)", () => {
    expect(
      mergeResultHasChanges({
        success: true,
        result: { holdout: null },
        conflicts: [],
      }),
    ).toBe(true);
    expect(
      mergeResultHasChanges({
        success: true,
        result: { holdout: { id: "h-1", value: "holdout" } },
        conflicts: [],
      }),
    ).toBe(true);
  });

  it("returns false when holdout key is absent from result", () => {
    expect(
      mergeResultHasChanges({
        success: true,
        result: {},
        conflicts: [],
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mergeRevision — archived + holdout
// ---------------------------------------------------------------------------

describe("mergeRevision with archived and holdout fields", () => {
  it("applies archived=true from revision to feature", () => {
    const revision = makeRevision({ archived: true });
    const merged = mergeRevision(baseFeature, revision, []);
    expect(merged.archived).toBe(true);
  });

  it("does not set archived when absent from revision", () => {
    const revision = makeRevision(); // no archived field
    const merged = mergeRevision(baseFeature, revision, []);
    // baseFeature has no archived field; merged should not add one either
    expect(merged.archived).toBeUndefined();
  });

  it("applies holdout from revision", () => {
    const revision = makeRevision({
      holdout: { id: "h-1", value: "holdout" },
    });
    const merged = mergeRevision(baseFeature, revision, []);
    expect(merged.holdout).toEqual({ id: "h-1", value: "holdout" });
  });

  it("removes holdout when revision sets it to null", () => {
    const featureWithHoldout: FeatureInterface = {
      ...baseFeature,
      holdout: { id: "h-1", value: "holdout" },
    };
    const revision = makeRevision({ holdout: null });
    const merged = mergeRevision(featureWithHoldout, revision, []);
    expect(merged.holdout).toBeUndefined();
  });

  it("leaves holdout unchanged when revision does not include it", () => {
    const featureWithHoldout: FeatureInterface = {
      ...baseFeature,
      holdout: { id: "h-1", value: "holdout" },
    };
    const revision = makeRevision(); // no holdout key
    const merged = mergeRevision(featureWithHoldout, revision, []);
    expect(merged.holdout).toEqual({ id: "h-1", value: "holdout" });
  });
});

// ---------------------------------------------------------------------------
// checkIfRevisionNeedsReview — holdout + archived + metadata normalization
// ---------------------------------------------------------------------------

describe("checkIfRevisionNeedsReview — holdout changes", () => {
  const allEnvironments = ["production", "staging"];
  const settings = makeSettings(makeReviewSetting());

  it("requires review when holdout is added", () => {
    const base = makeRevision({ version: 3 });
    const revision = makeRevision({
      holdout: { id: "h-1", value: "holdout" },
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

  it("requires review when holdout is removed", () => {
    const base = makeRevision({
      version: 3,
      holdout: { id: "h-1", value: "holdout" },
    });
    const revision = makeRevision({ holdout: null });
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

  it("does NOT require review when holdout is unchanged", () => {
    const base = makeRevision({
      version: 3,
      holdout: { id: "h-1", value: "holdout" },
    });
    const revision = makeRevision({
      holdout: { id: "h-1", value: "holdout" },
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

describe("checkIfRevisionNeedsReview — archived changes", () => {
  const allEnvironments = ["production"];
  const settings = makeSettings(makeReviewSetting());

  it("requires review when feature is archived", () => {
    const base = makeRevision({ version: 3, archived: false });
    const revision = makeRevision({ archived: true });
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

  it("does NOT require review when archived is unchanged", () => {
    const base = makeRevision({ version: 3, archived: false });
    const revision = makeRevision({ archived: false });
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

describe("checkIfRevisionNeedsReview — metadata normalization (no false positives)", () => {
  const allEnvironments = ["production"];

  it("does NOT require review when description changes from undefined to empty string", () => {
    const settings = makeSettings(
      makeReviewSetting({ featureRequireMetadataReview: true }),
    );
    const base = makeRevision({
      version: 3,
      metadata: { description: undefined },
    });
    const revision = makeRevision({ metadata: { description: "" } });
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

  it("does NOT require review when tags changes from undefined to empty array", () => {
    const settings = makeSettings(
      makeReviewSetting({ featureRequireMetadataReview: true }),
    );
    const base = makeRevision({ version: 3, metadata: {} });
    const revision = makeRevision({ metadata: { tags: [] } });
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

  it("DOES require review when tags actually change", () => {
    const settings = makeSettings(
      makeReviewSetting({ featureRequireMetadataReview: true }),
    );
    const base = makeRevision({ version: 3, metadata: { tags: ["a"] } });
    const revision = makeRevision({ metadata: { tags: ["a", "b"] } });
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
});

describe("checkIfRevisionNeedsReview — metadata-only vs non-metadata global changes", () => {
  const allEnvironments = ["production"];

  it("routes metadata-only change through featureRequireMetadataReview gate", () => {
    const settingsNoMetaReview = makeSettings(
      makeReviewSetting({ featureRequireMetadataReview: false }),
    );
    const settingsWithMetaReview = makeSettings(
      makeReviewSetting({ featureRequireMetadataReview: true }),
    );
    const base = makeRevision({ version: 3, metadata: { description: "old" } });
    const revision = makeRevision({ metadata: { description: "new" } });

    expect(
      checkIfRevisionNeedsReview({
        feature: baseFeature,
        baseRevision: base,
        revision,
        allEnvironments,
        settings: settingsNoMetaReview,
      }),
    ).toBe(false);

    expect(
      checkIfRevisionNeedsReview({
        feature: baseFeature,
        baseRevision: base,
        revision,
        allEnvironments,
        settings: settingsWithMetaReview,
      }),
    ).toBe(true);
  });

  it("non-metadata global changes (defaultValue) always require review regardless of featureRequireMetadataReview", () => {
    const settings = makeSettings(
      makeReviewSetting({ featureRequireMetadataReview: false }),
    );
    const base = makeRevision({ version: 3, metadata: { description: "old" } });
    // combine a metadata change with a defaultValue change → NOT metadata-only
    const revision = makeRevision({
      defaultValue: "true",
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
});
