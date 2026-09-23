import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ExperimentInterface } from "shared/types/experiment";
import { MAX_SAVED_GROUP_DEPTH } from "shared/sdk-versioning";
import {
  getSafeRolloutIdsForFeatureDefinitions,
  getSavedGroupIdsForFeatureDefinitions,
  loadSavedGroupsWithNested,
} from "back-end/src/util/featureDefinitionReferences.util";

const feature = (
  partial: Partial<Pick<FeatureInterface, "rules" | "prerequisites">>,
) =>
  ({ rules: [], ...partial }) as Pick<
    FeatureInterface,
    "rules" | "prerequisites"
  >;

const rule = (partial: Record<string, unknown>) =>
  ({
    id: "fr_1",
    type: "force",
    value: "true",
    description: "",
    enabled: true,
    ...partial,
  }) as unknown as FeatureInterface["rules"][number];

describe("getSavedGroupIdsForFeatureDefinitions", () => {
  it("collects rule savedGroups targeting and group operators inside conditions", () => {
    const ids = getSavedGroupIdsForFeatureDefinitions({
      features: [
        feature({
          rules: [
            rule({
              savedGroups: [
                { match: "all", ids: ["grp_a", "grp_b"] },
                { match: "none", ids: ["grp_c"] },
              ],
            }),
            rule({
              condition: JSON.stringify({
                $or: [
                  { $savedGroups: ["grp_d"] },
                  { id: { $inGroup: "grp_e" } },
                  { $not: { id: { $notInGroup: "grp_f" } } },
                ],
              }),
            }),
          ],
        }),
      ],
    });
    expect([...ids].sort()).toEqual([
      "grp_a",
      "grp_b",
      "grp_c",
      "grp_d",
      "grp_e",
      "grp_f",
    ]);
  });

  it("does not treat a group id used as an ordinary value as a reference", () => {
    const ids = getSavedGroupIdsForFeatureDefinitions({
      features: [
        feature({
          rules: [rule({ condition: JSON.stringify({ note: "grp_a" }) })],
        }),
      ],
    });
    expect([...ids]).toEqual([]);
  });

  it("collects feature-level and rule-level prerequisite conditions", () => {
    const ids = getSavedGroupIdsForFeatureDefinitions({
      features: [
        feature({
          prerequisites: [
            { id: "parent", condition: '{"$savedGroups":["grp_a"]}' },
          ],
          rules: [
            rule({
              prerequisites: [
                { id: "parent", condition: '{"$savedGroups":["grp_b"]}' },
              ],
            }),
          ],
        }),
      ],
    });
    expect([...ids].sort()).toEqual(["grp_a", "grp_b"]);
  });

  it("collects the rules of listed revisions", () => {
    const ids = getSavedGroupIdsForFeatureDefinitions({
      features: [feature({})],
      revisions: [
        {
          rules: [
            rule({ savedGroups: [{ match: "any", ids: ["grp_draft"] }] }),
          ],
        } as Pick<FeatureRevisionInterface, "rules">,
        // Legacy revisions may carry a non-array `rules`.
        { rules: undefined } as unknown as Pick<
          FeatureRevisionInterface,
          "rules"
        >,
      ],
    });
    expect([...ids]).toEqual(["grp_draft"]);
  });

  it("collects every phase of the given experiments", () => {
    const ids = getSavedGroupIdsForFeatureDefinitions({
      features: [feature({})],
      experiments: [
        {
          phases: [
            { condition: '{"$savedGroups":["grp_old"]}', savedGroups: [] },
            {
              condition: "{}",
              savedGroups: [{ match: "all", ids: ["grp_phase"] }],
            },
          ],
        } as unknown as Pick<ExperimentInterface, "phases">,
      ],
    });
    expect([...ids].sort()).toEqual(["grp_old", "grp_phase"]);
  });

  it("finds $savedGroups wherever nested expansion can reach it", () => {
    const ids = getSavedGroupIdsForFeatureDefinitions({
      features: [
        feature({
          rules: [
            rule({
              condition: JSON.stringify({
                id: { $inGroup: { $savedGroups: ["grp_in_object"] } },
                account: { $notInGroup: [{ $savedGroups: "grp_bare_string" }] },
                $nor: [
                  {
                    $and: [
                      { tags: { $elemMatch: { $savedGroups: ["grp_deep"] } } },
                    ],
                  },
                ],
              }),
            }),
          ],
        }),
      ],
    });
    expect([...ids].sort()).toEqual([
      "grp_bare_string",
      "grp_deep",
      "grp_in_object",
    ]);
  });

  it("skips malformed stored targeting instead of throwing", () => {
    const ids = getSavedGroupIdsForFeatureDefinitions({
      features: [
        feature({
          rules: [
            rule({
              savedGroups: [{ match: "all", ids: [null, "grp_kept", 3] }],
            }),
            rule({ savedGroups: [{ match: "all" }, null] }),
            rule({ savedGroups: {} }),
            rule({ condition: 7 }),
          ],
        }),
      ],
      experiments: [
        {
          phases: [
            null,
            { savedGroups: {} },
            { savedGroups: [{ ids: "grp_x" }] },
          ],
        } as unknown as Pick<ExperimentInterface, "phases">,
      ],
    });
    expect(ids).toEqual(["grp_kept"]);
  });

  it("skips malformed conditions and non-string ids instead of throwing", () => {
    const ids = getSavedGroupIdsForFeatureDefinitions({
      features: [
        feature({
          rules: [
            rule({ condition: "{not json" }),
            rule({
              condition: JSON.stringify({
                $savedGroups: ["grp_ok", 7, null, { $gt: "" }],
                id: { $inGroup: { $ne: null } },
              }),
            }),
          ],
        }),
      ],
    });
    expect([...ids]).toEqual(["grp_ok"]);
  });
});

describe("getSafeRolloutIdsForFeatureDefinitions", () => {
  it("collects safe rollout ids from feature and revision rules only", () => {
    const ids = getSafeRolloutIdsForFeatureDefinitions({
      features: [
        feature({
          rules: [
            rule({ type: "safe-rollout", safeRolloutId: "sr_live" }),
            rule({ type: "force" }),
          ],
        }),
      ],
      revisions: [
        {
          rules: [rule({ type: "safe-rollout", safeRolloutId: "sr_draft" })],
        } as Pick<FeatureRevisionInterface, "rules">,
      ],
    });
    expect([...ids].sort()).toEqual(["sr_draft", "sr_live"]);
  });
});

describe("loadSavedGroupsWithNested", () => {
  type Group = { id: string; type: "list" | "condition"; condition?: string };
  const store = (groups: Group[]) => {
    const calls: string[][] = [];
    const loadByIds = async (ids: string[]) => {
      calls.push([...ids].sort());
      return groups.filter((g) => ids.includes(g.id));
    };
    return { calls, loadByIds };
  };

  it("follows condition groups to the groups they reference, one query per level", async () => {
    const { calls, loadByIds } = store([
      {
        id: "grp_top",
        type: "condition",
        condition: '{"$savedGroups":["grp_mid","grp_list"]}',
      },
      {
        id: "grp_mid",
        type: "condition",
        condition: '{"id":{"$inGroup":"grp_leaf"}}',
      },
      { id: "grp_list", type: "list" },
      { id: "grp_leaf", type: "list" },
      { id: "grp_unused", type: "list" },
    ]);
    const loaded = await loadSavedGroupsWithNested(["grp_top"], loadByIds);
    expect(loaded.map((g) => g.id).sort()).toEqual([
      "grp_leaf",
      "grp_list",
      "grp_mid",
      "grp_top",
    ]);
    expect(calls).toEqual([["grp_top"], ["grp_list", "grp_mid"], ["grp_leaf"]]);
  });

  it("makes no query for an empty id set and tolerates ids that do not exist", async () => {
    const empty = store([]);
    expect(await loadSavedGroupsWithNested([], empty.loadByIds)).toEqual([]);
    expect(empty.calls).toEqual([]);

    const missing = store([{ id: "grp_a", type: "list" }]);
    const loaded = await loadSavedGroupsWithNested(
      ["grp_a", "grp_gone"],
      missing.loadByIds,
    );
    expect(loaded.map((g) => g.id)).toEqual(["grp_a"]);
    expect(missing.calls).toEqual([["grp_a", "grp_gone"]]);
  });

  it("terminates on a reference cycle without loading a group twice", async () => {
    const { calls, loadByIds } = store([
      {
        id: "grp_a",
        type: "condition",
        condition: '{"$savedGroups":["grp_b"]}',
      },
      {
        id: "grp_b",
        type: "condition",
        condition: '{"$savedGroups":["grp_a"]}',
      },
    ]);
    const loaded = await loadSavedGroupsWithNested(["grp_a"], loadByIds);
    expect(loaded.map((g) => g.id).sort()).toEqual(["grp_a", "grp_b"]);
    expect(calls).toEqual([["grp_a"], ["grp_b"]]);
  });

  it("follows a chain two levels past the depth nested expansion stops at, and no further", async () => {
    const chain: Group[] = Array.from({ length: 40 }, (_, i) => ({
      id: `grp_${i}`,
      type: "condition" as const,
      condition: JSON.stringify({ $savedGroups: [`grp_${i + 1}`] }),
    }));
    const { calls, loadByIds } = store(chain);
    const loaded = await loadSavedGroupsWithNested(["grp_0"], loadByIds);
    expect(calls).toHaveLength(MAX_SAVED_GROUP_DEPTH + 2);
    expect(loaded.map((g) => g.id)).toEqual(
      chain.slice(0, MAX_SAVED_GROUP_DEPTH + 2).map((g) => g.id),
    );
  });

  it("follows any group that is not an ID list, as nested expansion does", async () => {
    const { loadByIds } = store([
      {
        id: "grp_untyped",
        type: undefined as unknown as Group["type"],
        condition: '{"id":{"$inGroup":{"$savedGroups":["grp_inner"]}}}',
      },
      { id: "grp_inner", type: "list" },
    ]);
    const loaded = await loadSavedGroupsWithNested(["grp_untyped"], loadByIds);
    expect(loaded.map((g) => g.id).sort()).toEqual([
      "grp_inner",
      "grp_untyped",
    ]);
  });

  it("skips a condition group whose condition is malformed", async () => {
    const { loadByIds } = store([
      { id: "grp_bad", type: "condition", condition: "{nope" },
    ]);
    const loaded = await loadSavedGroupsWithNested(["grp_bad"], loadByIds);
    expect(loaded.map((g) => g.id)).toEqual(["grp_bad"]);
  });
});
