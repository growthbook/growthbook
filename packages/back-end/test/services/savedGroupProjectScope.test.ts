import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { SavedGroupInterface } from "shared/types/saved-group";
import type { Context } from "back-end/src/models/BaseModel";
import {
  assertFeatureSavedGroupScope,
  assertSavedGroupProjectScope,
  assertSavedGroupReferencesInScope,
  featureForSavedGroupValidation,
  savedGroupIdsInTargeting,
  savedGroupScopeChangeBreaksTargeting,
} from "back-end/src/services/savedGroupProjectScope";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
import { getRevisionsByStatus } from "back-end/src/models/FeatureRevisionModel";

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeaturesWithoutEditorFields: jest.fn(),
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
  it("finds structured, nested, negative and prerequisite references without matching literal IDs", () => {
    expect([
      ...savedGroupIdsInTargeting({
        savedGroups: [{ ids: ["structured"] }],
        condition:
          '{"$and":[{"id":{"$inGroup":"positive"}},{"$not":{"id":{"$notInGroup":"negative"}}},{"id":"literal"},{"$savedGroups":["nested"]},{"$savedGroups":"single"}]}',
        prerequisites: [{ condition: '{"value":{"$inGroup":"prerequisite"}}' }],
      }),
    ]).toEqual([
      "structured",
      "positive",
      "negative",
      "nested",
      "single",
      "prerequisite",
    ]);
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
  const getAll = jest.fn();
  const scan = { models: { savedGroups: { getAll } } } as unknown as Context;
  const context = {
    org: { settings: { enforceSavedGroupProjectScope: true } },
    scanContextOverride: scan,
  } as unknown as Context;
  beforeEach(() => {
    jest.clearAllMocks();
    getAll.mockResolvedValue([group("group", ["a"])]);
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
      expect(getAll).not.toHaveBeenCalled();
    },
  );

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
      prerequisites: [],
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
    getAll.mockResolvedValue([
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
      prerequisites: [],
    } as FeatureRevisionInterface);
    await expect(
      assertFeatureSavedGroupScope(context, proposed, f),
    ).rejects.toThrow("not available");
    proposed.rules = [{ ...f.rules[0], allProjects: false, projects: ["a"] }];
    await expect(
      assertFeatureSavedGroupScope(context, proposed, f),
    ).resolves.toBeUndefined();
  });

  it("checks feature and environment prerequisites", async () => {
    for (const f of [
      feature({
        project: "b",
        rules: [],
        prerequisites: [{ id: "other", ...targeting }],
      }),
      feature({
        project: "b",
        rules: [],
        environmentSettings: {
          production: {
            enabled: true,
            prerequisites: [{ id: "other", ...targeting }],
          },
        },
      }),
    ])
      await expect(assertFeatureSavedGroupScope(context, f)).rejects.toThrow(
        "not available",
      );
  });

  it("allows opening a repair draft and removing legacy invalid references", async () => {
    const invalid = feature({ project: "b" });
    await expect(
      assertFeatureSavedGroupScope(context, invalid, invalid),
    ).resolves.toBeUndefined();
    await expect(
      assertFeatureSavedGroupScope(context, { ...invalid, rules: [] }, invalid),
    ).resolves.toBeUndefined();
    // Publication passes no previous state: unchanged drafts are rechecked.
    await expect(
      assertFeatureSavedGroupScope(context, invalid),
    ).rejects.toThrow("not available");
  });
});

describe("Saved Group re-scoping", () => {
  const getGroups = jest.fn();
  const scan = {
    models: {
      savedGroups: { getAll: getGroups },
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
        prerequisites: [],
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
