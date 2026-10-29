import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterface } from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { ApiReqContext } from "back-end/types/api";
import { buildSDKPayloadForConnection } from "back-end/src/services/features";
import {
  getVisualExperimentPrerequisiteDependents,
  getVisualExperimentPrerequisiteIds,
} from "back-end/src/util/features";

jest.mock("back-end/src/models/VisualChangesetModel", () => ({
  getAllCbVisualExperiments: jest.fn().mockResolvedValue([]),
  getContextualBanditsWithVisualChangesets: jest.fn().mockResolvedValue([]),
}));

const prerequisite = { id: "parent", condition: '{"value": true}' };

function experiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_1",
    organization: "org_1",
    project: "prj_a",
    name: "Gated visual",
    status: "running",
    hashVersion: 2,
    phases: [
      {
        phase: "main",
        coverage: 1,
        variationWeights: [0.5, 0.5],
        prerequisites: [prerequisite],
      },
    ],
    variations: [
      { id: "v0", key: "0", name: "Control" },
      { id: "v1", key: "1", name: "Variation" },
    ],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    trackingKey: "gated-visual",
    archived: false,
    hasVisualChangesets: true,
    ...overrides,
  } as ExperimentInterface;
}

const visualChangeset = {
  id: "vcs_1",
  organization: "org_1",
  experiment: "exp_1",
  editorUrl: "https://example.com/",
  urlPatterns: [{ include: true, type: "simple", pattern: "*" }],
  visualChanges: [
    { id: "vc_0", variation: "v0", description: "", css: "", domMutations: [] },
    {
      id: "vc_1",
      variation: "v1",
      description: "",
      css: ".v1 { display: block; }",
      domMutations: [],
    },
  ],
} as VisualChangesetInterface;

const parent = {
  id: "parent",
  project: "prj_b",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  defaultValue: "true",
  organization: "org_1",
  owner: "",
  valueType: "boolean",
  archived: false,
  description: "",
  version: 1,
  environmentSettings: {
    production: {
      enabled: true,
      rules: [
        {
          type: "experiment",
          id: "parent-exp",
          enabled: true,
          coverage: 1,
          values: [
            { value: "false", weight: 0.5 },
            { value: "true", weight: 0.5 },
          ],
          hashAttribute: "id",
        },
      ],
    },
  },
} as unknown as FeatureInterface;

describe("visual experiment prerequisites in another project", () => {
  const context = {
    org: { id: "org_1", name: "Org", settings: {} },
    models: {},
  } as unknown as ApiReqContext;

  function build(includeReferencedPrerequisites: boolean) {
    const exp = experiment();
    return buildSDKPayloadForConnection({
      context,
      connection: {
        capabilities: ["bucketingV2", "prerequisites"],
        environment: "production",
        projects: ["prj_a"],
        includeReferencedPrerequisites,
        includeVisualExperiments: true,
      },
      data: {
        features: [parent],
        experimentMap: new Map([[exp.id, exp]]),
        groupMap: new Map(),
        safeRolloutMap: new Map(),
        savedGroups: [],
        holdoutsMap: new Map(),
        visualExperiments: [
          { type: "visual", experiment: exp, visualChangeset },
        ],
        urlRedirectExperiments: [],
      },
    });
  }

  it("carries the parent so the gated visual experiment is served", async () => {
    const out = await build(true);

    expect(out.features.parent).toBeDefined();
    expect(out.experiments).toHaveLength(1);
    expect(out.experiments?.[0].parentConditions).toEqual([
      expect.objectContaining({ id: "parent" }),
    ]);
  });

  it("drops the gated visual experiment when the parent is not carried", async () => {
    const out = await build(false);

    expect(out.features.parent).toBeUndefined();
    expect(out.experiments ?? []).toHaveLength(0);
  });

  it("lists visual and redirect experiments with a project as dependents", () => {
    expect(
      getVisualExperimentPrerequisiteDependents([
        experiment(),
        experiment({
          id: "exp_redirect",
          project: "prj_c",
          hasVisualChangesets: false,
          hasURLRedirects: true,
        }),
        experiment({ id: "exp_linked", hasVisualChangesets: false }),
        experiment({ id: "exp_no_project", project: "" }),
        experiment({
          id: "exp_ungated",
          phases: [{ phase: "main", coverage: 1, variationWeights: [1] }],
        }),
      ]),
    ).toEqual([
      { projects: ["prj_a"], prerequisiteIds: ["parent"] },
      { projects: ["prj_c"], prerequisiteIds: ["parent"] },
    ]);
  });

  it("collects each gate once", () => {
    expect(
      getVisualExperimentPrerequisiteIds([
        experiment(),
        experiment({ id: "exp_2" }),
      ]),
    ).toEqual(["parent"]);
  });
});
