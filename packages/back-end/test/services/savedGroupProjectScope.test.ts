import {
  autoMerge,
  featureMetadataEnvelope,
  fillRevisionFromFeature,
  liveRevisionFromFeature,
} from "shared/util";
import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { SavedGroupInterface } from "shared/types/saved-group";
import {
  flattenV1ToV2Rules,
  V1FeatureRule,
} from "back-end/src/util/flattenRules";
import { unclearedGates } from "back-end/src/revisions/publishGates";
import { BadRequestError } from "back-end/src/util/errors";
import type { Context } from "back-end/src/models/BaseModel";
import {
  assertSavedGroupReferencesInScope,
  featureForSavedGroupValidation,
  savedGroupIdsInTargeting,
  savedGroupScopeChangeBreaksTargeting,
} from "back-end/src/util/savedGroupProjectScope.util";
import {
  assertFeatureSavedGroupScope,
  assertSavedGroupProjectScope,
  collectSavedGroupScopeGate,
} from "back-end/src/services/savedGroupProjectScope";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import {
  getAllFeaturesWithoutEditorFields,
  collectHoldoutChangeGates,
  computeProposedFeatureForValidation,
} from "back-end/src/models/FeatureModel";
import {
  collectFeaturePublishGates,
  FeatureMergePlan,
} from "back-end/src/services/featurePublishGates";
import { getRevisionsByStatus } from "back-end/src/models/FeatureRevisionModel";

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeaturesWithoutEditorFields: jest.fn(),
  collectHoldoutChangeGates: jest.fn(),
  computeProposedFeatureForValidation: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevisionsByStatus: jest.fn(),
}));

const group = (
  id: string,
  projects?: string[],
  condition?: string,
): SavedGroupInterface => ({
  id,
  projects,
  condition,
  type: condition ? "condition" : "list",
  organization: "org",
  groupName: id,
  dateCreated: new Date(),
  dateUpdated: new Date(),
});
const feature = (
  projects: Partial<FeatureInterface> = {},
): FeatureInterface => ({
  id: "flag",
  project: "a",
  organization: "org",
  version: 1,
  dateCreated: new Date(),
  dateUpdated: new Date(),
  defaultValue: "false",
  valueType: "boolean",
  rules: [
    {
      id: "rule",
      type: "force",
      value: "true",
      savedGroups: [{ match: "all", ids: ["group"] }],
    },
  ],
  environmentSettings: {},
  ...projects,
});
const map = (...groups: SavedGroupInterface[]) =>
  new Map(groups.map((g) => [g.id, g]));
const targeting = { condition: '{"id":{"$inGroup":"group"}}' };

describe("Saved Group project scope", () => {
  it("finds structured, nested and negative references without matching literal IDs", () => {
    expect([
      ...savedGroupIdsInTargeting({
        savedGroups: [{ ids: ["structured"] }],
        condition:
          '{"$and":[{"id":{"$inGroup":"positive"}},{"$not":{"id":{"$notInGroup":"negative"}}},{"id":"literal"},{"$savedGroups":["nested"]},{"$savedGroups":"single"}]}',
      }),
    ]).toEqual(["structured", "positive", "negative", "nested", "single"]);
  });

  it.each([undefined, [], ["a"], ["a", "b"]])(
    "allows matching or unscoped groups (%j)",
    (projects) => {
      expect(() =>
        assertSavedGroupReferencesInScope(
          targeting,
          ["a"],
          map(group("group", projects)),
        ),
      ).not.toThrow();
    },
  );

  it.each([["a"], [""], null])(
    "rejects a scoped group outside the consumer scope (%j)",
    (projects) => {
      expect(() =>
        assertSavedGroupReferencesInScope(
          targeting,
          projects,
          map(group("group", ["b"])),
        ),
      ).toThrow("not available");
    },
  );

  it("rejects missing groups", () => {
    expect(() =>
      assertSavedGroupReferencesInScope(targeting, ["a"], map()),
    ).toThrow("not found");
  });

  it("checks transitive groups and terminates on cycles", () => {
    const groups = map(
      group("group", ["a"], '{"$savedGroups":"nested"}'),
      group("nested", ["b"], '{"$savedGroups":"group"}'),
    );
    expect(() =>
      assertSavedGroupReferencesInScope(targeting, ["a"], groups),
    ).toThrow("not available");
    groups.set("nested", group("nested", ["a"], '{"id":{"$inGroup":"group"}}'));
    expect(() =>
      assertSavedGroupReferencesInScope(targeting, ["a"], groups),
    ).not.toThrow();
  });

  it("detects re-scoping through multiple nested groups", () => {
    const groups = map(
      group("group", [], '{"$savedGroups":"middle"}'),
      group("middle", [], '{"id":{"$notInGroup":"leaf"}}'),
    );
    expect(
      savedGroupScopeChangeBreaksTargeting(
        targeting,
        ["a"],
        group("leaf", ["b"]),
        groups,
      ),
    ).toBe(true);
    expect(
      savedGroupScopeChangeBreaksTargeting(
        targeting,
        ["a"],
        group("leaf", ["a"]),
        groups,
      ),
    ).toBe(false);
  });
});

describe("feature writes and publish validation", () => {
  const getAllWithoutValues = jest.fn();
  const scan = {
    models: { savedGroups: { getAllWithoutValues } },
  } as unknown as Context;
  const context = {
    org: { settings: { enforceSavedGroupProjectScope: true } },
    scanContextOverride: scan,
  } as unknown as Context;
  beforeEach(() => {
    jest.clearAllMocks();
    getAllWithoutValues.mockResolvedValue([group("group", ["a"])]);
  });

  it.each([undefined, false])(
    "leaves cross-project writes unchanged by default (%s)",
    async (enabled) => {
      await expect(
        assertFeatureSavedGroupScope(
          {
            ...context,
            org: { settings: { enforceSavedGroupProjectScope: enabled } },
          } as Context,
          feature({ project: "b" }),
        ),
      ).resolves.toBeUndefined();
      expect(getAllWithoutValues).not.toHaveBeenCalled();
    },
  );

  it("still rejects malformed conditions on the feature's own write", async () => {
    const malformed = feature();
    malformed.rules[0].condition = "{";
    await expect(
      assertFeatureSavedGroupScope(context, malformed),
    ).rejects.toThrow("Invalid targeting condition JSON");
  });

  it("rejects a rule write referencing another project's group", async () => {
    await expect(
      assertFeatureSavedGroupScope(context, feature({ project: "b" })),
    ).rejects.toThrow("not available");
  });

  it("checks effective draft metadata when moving a feature", async () => {
    const original = feature();
    const proposed = featureForSavedGroupValidation(original, {
      metadata: { project: "b" },
      rules: original.rules,
    } as FeatureRevisionInterface);
    await expect(
      assertFeatureSavedGroupScope(context, proposed, original),
    ).rejects.toThrow("not available");
  });

  it("requires groups to cover all delivery projects", async () => {
    await expect(
      assertFeatureSavedGroupScope(
        context,
        feature({ targetingProjects: ["b"] }),
      ),
    ).rejects.toThrow("not available");
    await expect(
      assertFeatureSavedGroupScope(
        context,
        feature({ targetingAllProjects: true }),
      ),
    ).rejects.toThrow("not available");
  });

  it("honors a rule's narrower delivery scope", async () => {
    const f = feature({ targetingAllProjects: true });
    f.rules[0] = { ...f.rules[0], allProjects: false, projects: ["a"] };
    await expect(
      assertFeatureSavedGroupScope(context, f),
    ).resolves.toBeUndefined();
  });

  it("validates a diamond DAG against rule delivery, not parent group scopes or the owning Project", async () => {
    getAllWithoutValues.mockResolvedValue([
      group("group", ["a", "b"], '{"$savedGroups":["left","right"]}'),
      group("left", ["b", "c"], '{"$savedGroups":"leaf"}'),
      group("right", [], '{"$savedGroups":"leaf"}'),
      group("leaf", ["b"]),
    ]);
    const f = feature({ targetingProjects: ["b"] });
    f.rules[0] = { ...f.rules[0], allProjects: false, projects: ["b"] };
    await expect(
      assertFeatureSavedGroupScope(context, f),
    ).resolves.toBeUndefined();
    f.rules[0] = { ...f.rules[0], allProjects: true };
    await expect(assertFeatureSavedGroupScope(context, f)).rejects.toThrow(
      "not available",
    );
  });

  it("does not impose group scope on a rule that reaches no Project", async () => {
    const f = feature();
    f.rules[0] = { ...f.rules[0], allProjects: false, projects: ["b"] };
    await expect(
      assertFeatureSavedGroupScope(context, f),
    ).resolves.toBeUndefined();
    f.rules[0].projects = [];
    await expect(
      assertFeatureSavedGroupScope(context, f),
    ).resolves.toBeUndefined();
  });

  it("checks staged targetingProjects, including narrowing a rule to those Projects", async () => {
    const f = feature();
    const proposed = featureForSavedGroupValidation(f, {
      metadata: { targetingProjects: ["b"] },
      rules: f.rules,
    } as FeatureRevisionInterface);
    await expect(
      assertFeatureSavedGroupScope(context, proposed, f),
    ).rejects.toThrow("not available");
    proposed.rules = [{ ...f.rules[0], allProjects: false, projects: ["a"] }];
    await expect(
      assertFeatureSavedGroupScope(context, proposed, f),
    ).resolves.toBeUndefined();
  });

  it("preserves legacy references when opening drafts, editing values, and publishing", async () => {
    const existing = feature({ project: "b" });
    const edited = {
      ...existing,
      rules: [{ ...existing.rules[0], value: "false" }],
    };
    for (const proposed of [existing, edited, { ...existing, rules: [] }]) {
      await expect(
        assertFeatureSavedGroupScope(context, proposed, existing),
      ).resolves.toBeUndefined();
    }
    expect(getAllWithoutValues).not.toHaveBeenCalled();
    // A new Feature Flag receives no baseline and must satisfy strict scope.
    await expect(
      assertFeatureSavedGroupScope(context, existing),
    ).rejects.toThrow("not available");
  });

  it("validates a newly added rule even if another rule already references the same group", async () => {
    const existing = feature({ project: "b" });
    const proposed = {
      ...existing,
      rules: [...existing.rules, { ...existing.rules[0], id: "new-rule" }],
    };
    await expect(
      assertFeatureSavedGroupScope(context, proposed, existing),
    ).rejects.toThrow("not available");
  });

  it.each([false, true])(
    "rejects an added legacy-stem sibling regardless of order (new first: %s)",
    async (newFirst) => {
      const existing = feature({ project: "b" });
      existing.rules[0].allEnvironments = true;
      const added = {
        ...existing.rules[0],
        id: "rule__production",
        value: "false",
      };
      await expect(
        assertFeatureSavedGroupScope(
          context,
          {
            ...existing,
            rules: newFirst
              ? [added, ...existing.rules]
              : [...existing.rules, added],
          },
          existing,
        ),
      ).rejects.toThrow("not available");
    },
  );

  it("rejects ambiguous legacy matches instead of exempting two added rules", async () => {
    const existing = feature({ project: "b" });
    existing.rules[0].allEnvironments = true;
    const proposed = {
      ...existing,
      rules: ["rule__production", "rule__dev"].map((id) => ({
        ...existing.rules[0],
        id,
      })),
    };
    await expect(
      assertFeatureSavedGroupScope(context, proposed, existing),
    ).rejects.toThrow("not available");
  });

  it("checks only new references when editing a rule with a legacy reference", async () => {
    getAllWithoutValues.mockResolvedValue([
      group("group", ["a"]),
      group("allowed", ["b"]),
      group("foreign", ["a"]),
    ]);
    const existing = feature({ project: "b" });
    const proposed = {
      ...existing,
      rules: [
        {
          ...existing.rules[0],
          savedGroups: [{ match: "all" as const, ids: ["group", "allowed"] }],
        },
      ],
    };
    await expect(
      assertFeatureSavedGroupScope(context, proposed, existing),
    ).resolves.toBeUndefined();
    proposed.rules[0].savedGroups[0].ids.push("foreign");
    await expect(
      assertFeatureSavedGroupScope(context, proposed, existing),
    ).rejects.toThrow("not available");
  });

  it("does not grandfather a new rule using a legacy rule without an ID", async () => {
    const existing = feature({ project: "b" });
    Reflect.deleteProperty(existing.rules[0], "id");
    const proposed = {
      ...existing,
      rules: [{ ...existing.rules[0], id: "new-rule" }],
    };
    await expect(
      assertFeatureSavedGroupScope(context, proposed, existing),
    ).rejects.toThrow("not available");
  });

  it("rejects new Project exposure even when the existing Project is already out of scope", async () => {
    const existing = feature({ project: "b" });
    for (const proposed of [
      { ...existing, targetingProjects: ["c"] },
      { ...existing, targetingAllProjects: true },
      { ...existing, project: "c" },
    ]) {
      await expect(
        assertFeatureSavedGroupScope(context, proposed, existing),
      ).rejects.toThrow("not available");
    }
    // Expanding into a Project the group covers remains allowed.
    await expect(
      assertFeatureSavedGroupScope(
        context,
        { ...existing, targetingProjects: ["a"] },
        existing,
      ),
    ).resolves.toBeUndefined();
  });

  it("allows narrowing an existing All Projects reference", async () => {
    const existing = feature({ targetingAllProjects: true });
    const proposed = { ...existing, project: "b", targetingAllProjects: false };
    await expect(
      assertFeatureSavedGroupScope(context, proposed, existing),
    ).resolves.toBeUndefined();
    expect(getAllWithoutValues).not.toHaveBeenCalled();
  });

  it("checks the full graph for a new root even if its descendant is already referenced", async () => {
    getAllWithoutValues.mockResolvedValue([
      group("group", ["a"]),
      group("new-root", ["b"], '{"$savedGroups":"group"}'),
    ]);
    const existing = feature({ project: "b" });
    const proposed = {
      ...existing,
      rules: [
        {
          ...existing.rules[0],
          savedGroups: [{ match: "all" as const, ids: ["new-root"] }],
        },
      ],
    };
    await expect(
      assertFeatureSavedGroupScope(context, proposed, existing),
    ).rejects.toThrow("not available");
  });

  it("preserves existing rule references across legacy rule ID normalization", async () => {
    const existing = feature({ project: "b" });
    existing.rules[0] = {
      ...existing.rules[0],
      id: "rule__production",
      environments: ["production"],
    };
    const proposed = {
      ...existing,
      rules: [{ ...existing.rules[0], id: "rule", value: "false" }],
    };
    await expect(
      assertFeatureSavedGroupScope(context, proposed, existing),
    ).resolves.toBeUndefined();
    expect(getAllWithoutValues).not.toHaveBeenCalled();
  });

  it("preserves references when a v1 value edit splits a shared rule into separate environments", async () => {
    const existing = feature({ project: "b" });
    existing.rules[0].allEnvironments = true;
    const legacy = existing.rules[0] as unknown as V1FeatureRule;
    const proposed = {
      ...existing,
      rules: flattenV1ToV2Rules(
        { production: [{ ...legacy, value: "false" }], dev: [legacy] },
        {
          applicableEnvs: ["production", "dev"],
        },
      ),
    };
    expect(proposed.rules).toHaveLength(2);
    await expect(
      assertFeatureSavedGroupScope(context, proposed, existing),
    ).resolves.toBeUndefined();
    expect(getAllWithoutValues).not.toHaveBeenCalled();
  });

  it("preserves references when a v1 value edit merges retired environment siblings", async () => {
    const legacy = feature().rules[0] as unknown as V1FeatureRule;
    const options = { applicableEnvs: ["production", "dev"] };
    const existing = feature({
      project: "b",
      rules: flattenV1ToV2Rules(
        { production: [{ ...legacy, value: "false" }], dev: [legacy] },
        options,
      ),
    });
    const proposed = {
      ...existing,
      rules: flattenV1ToV2Rules(
        { production: [legacy], dev: [legacy] },
        options,
      ),
    };
    expect(existing.rules).toHaveLength(2);
    expect(proposed.rules).toHaveLength(1);
    await expect(
      assertFeatureSavedGroupScope(context, proposed, existing),
    ).resolves.toBeUndefined();
    expect(getAllWithoutValues).not.toHaveBeenCalled();
  });

  it("preserves references already stored in a draft when it is edited and published", async () => {
    const live = feature({ rules: [] });
    const storedDraft = featureForSavedGroupValidation(live, {
      metadata: { project: "b" },
      rules: feature().rules,
    } as FeatureRevisionInterface);
    const edited = {
      ...storedDraft,
      rules: [{ ...storedDraft.rules[0], value: "false" }],
    };
    await expect(
      assertFeatureSavedGroupScope(context, edited, storedDraft),
    ).resolves.toBeUndefined();
    await expect(
      assertFeatureSavedGroupScope(context, edited, [live, storedDraft]),
    ).resolves.toBeUndefined();
    expect(getAllWithoutValues).not.toHaveBeenCalled();
  });

  it.each([{ targetingAllProjects: true }, { targetingProjects: ["b"] }])(
    "does not grandfather live targeting added after a sparse draft was stored (%j)",
    async (expansion) => {
      const original = feature({ rules: [] });
      const metadata: FeatureRevisionInterface["metadata"] =
        featureMetadataEnvelope(original);
      // Simulate legacy persisted metadata: undefined defaults were omitted.
      delete metadata.targetingAllProjects;
      delete metadata.targetingProjects;
      const base = { version: 1, defaultValue: "false", rules: [], metadata };
      const draft = { ...base, version: 2, rules: feature().rules };
      const live = feature({ ...expansion, version: 3, rules: [] });
      const merge = autoMerge(
        liveRevisionFromFeature(
          { ...base, version: 3, metadata: featureMetadataEnvelope(live) },
          live,
        ),
        fillRevisionFromFeature(base, live),
        draft,
        [],
        {},
      );
      expect(merge.success).toBe(true);
      if (!merge.success) throw new Error("Unexpected merge conflict");
      expect(merge.result.rules).toEqual(draft.rules);
      const merged = {
        ...live,
        ...merge.result.metadata,
        rules: merge.result.rules ?? live.rules,
      };
      await expect(
        assertFeatureSavedGroupScope(context, merged, [
          live,
          featureForSavedGroupValidation(live, draft),
        ]),
      ).rejects.toThrow("not available");
    },
  );

  it("retains explicitly stored All Projects and additional Project exemptions", async () => {
    for (const targeting of [
      { targetingAllProjects: true },
      { targetingProjects: ["b"] },
    ]) {
      const live = feature({ ...targeting, rules: [] });
      const draft = {
        metadata: featureMetadataEnvelope(live),
        rules: feature().rules,
      };
      const stored = featureForSavedGroupValidation(live, draft);
      await expect(
        assertFeatureSavedGroupScope(
          context,
          {
            ...stored,
            rules: [{ ...stored.rules[0], value: "false" }],
          },
          stored,
        ),
      ).resolves.toBeUndefined();
      await expect(
        assertFeatureSavedGroupScope(
          context,
          { ...live, rules: stored.rules },
          [live, stored],
        ),
      ).resolves.toBeUndefined();
    }
    expect(getAllWithoutValues).not.toHaveBeenCalled();
  });

  it("preserves a sparse draft's existing out-of-scope reference when its scope is unchanged", async () => {
    const live = feature({ project: "b", rules: [] });
    const draft = { metadata: { project: "b" }, rules: feature().rules };
    const stored = featureForSavedGroupValidation(live, draft);
    await expect(
      assertFeatureSavedGroupScope(
        context,
        {
          ...stored,
          rules: [{ ...stored.rules[0], value: "false" }],
        },
        stored,
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertFeatureSavedGroupScope(context, { ...live, rules: stored.rules }, [
        live,
        stored,
      ]),
    ).resolves.toBeUndefined();
    expect(getAllWithoutValues).not.toHaveBeenCalled();
  });

  it("rejects a merge that combines a stored draft reference with new live targeting Projects", async () => {
    const live = feature({ project: "b", targetingProjects: ["c"], rules: [] });
    const storedDraft = featureForSavedGroupValidation(live, {
      metadata: { project: "b", targetingProjects: [] },
      rules: feature().rules,
    } as FeatureRevisionInterface);
    const merged = { ...live, rules: storedDraft.rules };
    await expect(
      assertFeatureSavedGroupScope(context, merged, [live, storedDraft]),
    ).rejects.toThrow("not available");
  });
});

describe("Saved Group re-scoping", () => {
  const getGroups = jest.fn();
  const scan = {
    models: {
      savedGroups: { getAllWithoutValues: getGroups },
    },
  } as unknown as Context;
  const context = {
    org: { id: "org", settings: { enforceSavedGroupProjectScope: true } },
  } as unknown as Context;
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(getContextForAgendaJobByOrgObject)
      .mockReturnValue(
        scan as ReturnType<typeof getContextForAgendaJobByOrgObject>,
      );
    getGroups.mockResolvedValue([group("group", ["a", "b"])]);
    jest.mocked(getAllFeaturesWithoutEditorFields).mockResolvedValue([]);
    jest.mocked(getRevisionsByStatus).mockResolvedValue([]);
  });
  const narrow = () =>
    assertSavedGroupProjectScope(
      context,
      group("group", ["b"]),
      group("group", ["a", "b"]),
    );

  it.each([undefined, false])(
    "leaves group scope and graph edits unchanged by default (%s)",
    async (enabled) => {
      const lenientContext = {
        org: { settings: { enforceSavedGroupProjectScope: enabled } },
      } as Context;
      await expect(
        assertSavedGroupProjectScope(
          lenientContext,
          group("group", ["b"], '{"$savedGroups":"foreign"}'),
          group("group", ["a", "b"]),
        ),
      ).resolves.toBeUndefined();
      expect(getGroups).not.toHaveBeenCalled();
      expect(getAllFeaturesWithoutEditorFields).not.toHaveBeenCalled();
    },
  );

  it("does not scan consumers when creating a condition group with nested references", async () => {
    await expect(
      assertSavedGroupProjectScope(
        context,
        group("new", ["b"], '{"$savedGroups":"foreign"}'),
      ),
    ).resolves.toBeUndefined();
    expect(getContextForAgendaJobByOrgObject).not.toHaveBeenCalled();
    expect(getGroups).not.toHaveBeenCalled();
    expect(getAllFeaturesWithoutEditorFields).not.toHaveBeenCalled();
    expect(getRevisionsByStatus).not.toHaveBeenCalled();
  });

  it("ignores malformed legacy conditions on unrelated live flags and drafts", async () => {
    const malformed = feature({
      rules: [{ ...feature().rules[0], savedGroups: [], condition: "{" }],
    });
    jest
      .mocked(getAllFeaturesWithoutEditorFields)
      .mockResolvedValue([malformed]);
    jest.mocked(getRevisionsByStatus).mockResolvedValue([
      {
        featureId: malformed.id,
        version: 2,
        rules: malformed.rules,
        metadata: { project: "a" },
      } as FeatureRevisionInterface,
    ]);
    await expect(narrow()).resolves.toBeUndefined();
  });

  it("still checks explicit group references next to a malformed condition", async () => {
    const malformed = feature();
    malformed.rules[0].condition = "{";
    jest
      .mocked(getAllFeaturesWithoutEditorFields)
      .mockResolvedValue([malformed]);
    await expect(narrow()).rejects.toThrow("existing Feature Flag references");
  });

  it("ignores a malformed legacy group branch while checking its valid siblings", async () => {
    getGroups.mockResolvedValue([
      group("group", ["a", "b"]),
      group("broken", [], "{"),
    ]);
    const consumer = feature();
    consumer.rules[0].savedGroups = [
      { match: "all", ids: ["broken", "group"] },
    ];
    jest
      .mocked(getAllFeaturesWithoutEditorFields)
      .mockResolvedValue([consumer]);
    await expect(narrow()).rejects.toThrow("existing Feature Flag references");
  });

  it("blocks condition edits that introduce an out-of-scope descendant", async () => {
    getGroups.mockResolvedValue([
      group("group", ["a", "b"]),
      group("middle", [], '{"$savedGroups":"leaf"}'),
      group("leaf", ["b"]),
    ]);
    jest
      .mocked(getAllFeaturesWithoutEditorFields)
      .mockResolvedValue([feature()]);
    await expect(
      assertSavedGroupProjectScope(
        context,
        group("group", ["a", "b"], '{"$savedGroups":"middle"}'),
        group("group", ["a", "b"]),
      ),
    ).rejects.toThrow("existing Feature Flag references");
  });

  it("permits condition edits with different parent and child scopes when the consumer is covered", async () => {
    getGroups.mockResolvedValue([
      group("group", ["a", "b"]),
      group("leaf", ["b", "c"]),
    ]);
    const f = feature({ targetingProjects: ["b"] });
    f.rules[0] = { ...f.rules[0], allProjects: false, projects: ["b"] };
    jest.mocked(getAllFeaturesWithoutEditorFields).mockResolvedValue([f]);
    await expect(
      assertSavedGroupProjectScope(
        context,
        group("group", ["a", "b"], '{"$savedGroups":"leaf"}'),
        group("group", ["a", "b"]),
      ),
    ).resolves.toBeUndefined();
  });

  it("allows repairing a graph with existing scope violations", async () => {
    getGroups.mockResolvedValue([group("leaf", ["b"])]);
    jest
      .mocked(getAllFeaturesWithoutEditorFields)
      .mockResolvedValue([feature()]);
    await expect(
      assertSavedGroupProjectScope(
        context,
        group("group", [], '{"country":"US"}'),
        group("group", [], '{"$savedGroups":"leaf"}'),
      ),
    ).resolves.toBeUndefined();
  });

  it("detects newly denied Projects even if another Project already violates scope", async () => {
    jest
      .mocked(getAllFeaturesWithoutEditorFields)
      .mockResolvedValue([feature({ targetingProjects: ["c"] })]);
    await expect(narrow()).rejects.toThrow("existing Feature Flag references");
  });

  it("blocks narrowing a grandfathered group for an All Projects consumer", async () => {
    jest
      .mocked(getAllFeaturesWithoutEditorFields)
      .mockResolvedValue([feature({ targetingAllProjects: true })]);
    await expect(narrow()).rejects.toThrow("existing Feature Flag references");
  });

  it("detects lost coverage through a nested All Projects reference", async () => {
    getGroups.mockResolvedValue([
      group("root", [], '{"$savedGroups":"group"}'),
      group("group", ["a", "b"]),
    ]);
    const f = feature({ targetingAllProjects: true });
    f.rules[0].savedGroups = [{ match: "all", ids: ["root"] }];
    jest.mocked(getAllFeaturesWithoutEditorFields).mockResolvedValue([f]);
    await expect(narrow()).rejects.toThrow("existing Feature Flag references");
  });

  it("preserves an All Projects violation when only the group's condition changes", async () => {
    jest
      .mocked(getAllFeaturesWithoutEditorFields)
      .mockResolvedValue([feature({ targetingAllProjects: true })]);
    getGroups.mockResolvedValue([group("leaf", [])]);
    await expect(
      assertSavedGroupProjectScope(
        context,
        group("group", ["a", "b"], '{"$savedGroups":"leaf"}'),
        group("group", ["a", "b"], '{"country":"US"}'),
      ),
    ).resolves.toBeUndefined();
  });

  it("blocks re-scoping used by an unreadable, disabled or archived feature", async () => {
    jest
      .mocked(getAllFeaturesWithoutEditorFields)
      .mockResolvedValue([feature({ id: "secret-name", archived: true })]);
    await expect(narrow()).rejects.toThrow("existing Feature Flag references");
    await expect(narrow()).rejects.not.toThrow("secret-name");
    expect(getAllFeaturesWithoutEditorFields).toHaveBeenCalledWith(scan, {
      includeArchived: true,
    });
  });

  it("blocks re-scoping when only an active feature draft references the group", async () => {
    jest
      .mocked(getAllFeaturesWithoutEditorFields)
      .mockResolvedValue([feature({ rules: [] })]);
    jest.mocked(getRevisionsByStatus).mockResolvedValue([
      {
        featureId: "flag",
        version: 2,
        rules: feature().rules,
        metadata: { project: "a" },
      } as FeatureRevisionInterface,
    ]);
    await expect(narrow()).rejects.toThrow("active Feature Flag drafts");
  });

  it("allows groups to cross their own Project boundaries without consumers", async () => {
    getGroups.mockResolvedValue([
      group("parent", ["a"], '{"$savedGroups":"group"}'),
    ]);
    await expect(narrow()).resolves.toBeUndefined();
  });

  it("checks a consuming flag through nested Saved Groups", async () => {
    getGroups.mockResolvedValue([
      group("group", ["a", "b"]),
      group("parent", [], '{"$savedGroups":"group"}'),
    ]);
    jest.mocked(getAllFeaturesWithoutEditorFields).mockResolvedValue([
      feature({
        rules: [
          {
            ...feature().rules[0],
            savedGroups: [{ match: "all", ids: ["parent"] }],
          },
        ],
      }),
    ]);
    await expect(narrow()).rejects.toThrow("existing Feature Flag references");
  });

  it("does not block narrowing for an unrelated legacy reference", async () => {
    getGroups.mockResolvedValue([group("other", ["b"])]);
    jest.mocked(getAllFeaturesWithoutEditorFields).mockResolvedValue([
      feature({
        rules: [
          {
            id: "rule",
            type: "force",
            value: "true",
            condition: '{"id":{"$inGroup":"other"}}',
          },
        ],
      }),
    ]);
    await expect(narrow()).resolves.toBeUndefined();
  });

  it("allows narrowing with no invalidated references", async () => {
    jest
      .mocked(getAllFeaturesWithoutEditorFields)
      .mockResolvedValue([feature({ project: "b" })]);
    await expect(narrow()).resolves.toBeUndefined();
  });

  it("allows widening a list group without scanning", async () => {
    await expect(
      assertSavedGroupProjectScope(
        context,
        group("group", []),
        group("group", ["a"]),
      ),
    ).resolves.toBeUndefined();
    expect(getGroups).not.toHaveBeenCalled();
  });

  it("allows an unscoped parent with a scoped child when no consumer loses scope", async () => {
    getGroups.mockResolvedValue([group("group", ["a"])]);
    await expect(
      assertSavedGroupProjectScope(
        context,
        group("parent", [], targeting.condition),
      ),
    ).resolves.toBeUndefined();
  });

  it("honors a bulk release's proposed feature state", async () => {
    jest
      .mocked(getAllFeaturesWithoutEditorFields)
      .mockResolvedValue([feature({ project: "b" })]);
    await expect(
      assertSavedGroupProjectScope(
        { ...context, scanContextOverride: scan } as Context,
        group("group", ["b"]),
        group("group", ["a", "b"]),
      ),
    ).resolves.toBeUndefined();
    expect(getContextForAgendaJobByOrgObject).not.toHaveBeenCalled();
  });
});

describe("Saved Group project scope publish gates", () => {
  it("returns a blocker that no publish override clears", async () => {
    const gates = await collectSavedGroupScopeGate(async () => {
      throw new BadRequestError("new Project exposure");
    });
    expect(gates).toEqual([
      {
        type: "saved-group-project-scope",
        severity: "blocker",
        messages: ["new Project exposure"],
        override: null,
        requiresPermission: null,
        resolution: null,
      },
    ]);
    expect(
      unclearedGates(
        gates,
        {
          ignoreWarnings: true,
          skipSchemaValidation: true,
          skipHooks: true,
        },
        () => true,
      ),
    ).toEqual(gates);
  });

  it("does not add gates for a valid or grandfathered reference", async () => {
    await expect(collectSavedGroupScopeGate(async () => {})).resolves.toEqual(
      [],
    );
  });

  it("enforces scope without a manual schedule warning on automatic publishes", async () => {
    const f = feature();
    const revision = {
      rules: f.rules,
      version: 2,
      status: "draft",
      autoPublishOnApproval: true,
      scheduledPublishAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } as FeatureRevisionInterface;
    const context = {
      org: { settings: { enforceSavedGroupProjectScope: true } },
      scanContextOverride: {
        models: {
          savedGroups: {
            getAllWithoutValues: jest
              .fn()
              .mockResolvedValue([group("group", ["a"])]),
          },
        },
      },
    } as unknown as Parameters<typeof collectFeaturePublishGates>[0]["context"];
    jest.mocked(collectHoldoutChangeGates).mockResolvedValue([]);
    jest.mocked(computeProposedFeatureForValidation).mockReturnValue({
      proposedFeature: feature({ targetingProjects: ["b"] }),
      defaultToCheck: undefined,
      rulesToCheck: [],
    });
    const gates = await collectFeaturePublishGates({
      context,
      feature: f,
      revision,
      plan: {
        rebaseRequired: true,
        requiresReview: false,
        mergeResult: {},
      } as FeatureMergePlan,
      includeValidationGates: false,
    });
    expect(gates.map((g) => g.type)).toEqual([
      "stale-base",
      "saved-group-project-scope",
    ]);
    expect(gates[1].override).toBeNull();
  });

  it("propagates infrastructure failures instead of turning them into blockers", async () => {
    const error = new Error("database unavailable");
    await expect(
      collectSavedGroupScopeGate(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
