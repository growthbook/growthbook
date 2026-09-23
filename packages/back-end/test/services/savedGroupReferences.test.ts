import type { ReqContext } from "back-end/types/request";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { loadSavedGroupReferences } from "back-end/src/services/savedGroups";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeaturesWithoutEditorFields: jest.fn(async () => []),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getAllExperiments: jest.fn(async () => []),
  getPayloadKeysForAllEnvs: jest.fn(),
}));

// A contextual bandit's targeting is served on its linked features' rules, so a
// group it names counts as referenced the same way a feature rule's would.
describe("loadSavedGroupReferences", () => {
  const group = { id: "sg_1", groupName: "Beta", condition: "" };
  const bandit = (id: string, fields: Record<string, unknown>) => ({
    id,
    name: id,
    project: "p1",
    archived: false,
    condition: "",
    savedGroups: [],
    ...fields,
  });
  const context = (bandits: ReturnType<typeof bandit>[]) =>
    ({
      org: { id: "org", settings: { environments: [{ id: "production" }] } },
      models: {
        savedGroups: { getAll: async () => [group] },
        contextualBandits: { getAll: async () => bandits },
      },
    }) as unknown as ReqContext;

  beforeEach(() => {
    jest.mocked(getAllFeaturesWithoutEditorFields).mockResolvedValue([]);
    jest.mocked(getAllExperiments).mockResolvedValue([]);
  });

  it("sees a group named only inside a prerequisite condition, on every holder", async () => {
    const gate = { id: "parent", condition: '{"value":{"$inGroup":"sg_1"}}' };
    jest.mocked(getAllFeaturesWithoutEditorFields).mockResolvedValue([
      {
        id: "f_rule",
        environmentSettings: { production: { enabled: true } },
        rules: [
          {
            type: "force",
            enabled: true,
            allEnvironments: true,
            prerequisites: [gate],
          },
        ],
      },
      {
        id: "f_top",
        environmentSettings: {},
        rules: [],
        prerequisites: [gate],
      },
    ] as never);
    jest
      .mocked(getAllExperiments)
      .mockResolvedValue([
        { id: "exp", name: "exp", phases: [{ prerequisites: [gate] }] },
      ] as never);

    const refs = await loadSavedGroupReferences(
      context([bandit("cb", { prerequisites: [gate] })]),
      "sg_1",
    );
    expect(refs?.features.map((f) => f.id)).toEqual(["f_rule", "f_top"]);
    expect(refs?.experiments.map((e) => e.id)).toEqual(["exp"]);
    expect(refs?.contextualBandits.map((cb) => cb.id)).toEqual(["cb"]);
  });

  it("counts bandits that name the group in their condition or saved groups", async () => {
    const refs = await loadSavedGroupReferences(
      context([
        bandit("cb_cond", { condition: '{"id":{"$inGroup":"sg_1"}}' }),
        bandit("cb_groups", { savedGroups: [{ match: "any", ids: ["sg_1"] }] }),
        bandit("cb_archived", {
          archived: true,
          savedGroups: [{ match: "any", ids: ["sg_1"] }],
        }),
        bandit("cb_other", { savedGroups: [{ match: "any", ids: ["sg_2"] }] }),
      ]),
      "sg_1",
    );
    expect(refs?.contextualBandits.map((cb) => cb.id)).toEqual([
      "cb_cond",
      "cb_groups",
    ]);
  });
});
