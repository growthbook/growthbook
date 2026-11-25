import cloneDeep from "lodash/cloneDeep";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { OrganizationInterface } from "shared/types/organization";
import {
  EventReach,
  getChangedExperimentEntities,
  getDependentEntities,
  getExperimentReach,
  dependentsReach,
  refreshThenReport,
  scopeRelatedEntities,
} from "back-end/src/events/relatedEntities";

const envs = ["dev", "prod"];
const scope = { environments: envs, projectIds: ["prj_a", "prj_b"] };

const experimentRule = (overrides: Partial<FeatureRule> = {}): FeatureRule =>
  ({
    id: "fr_exp",
    type: "experiment-ref",
    description: "",
    condition: "",
    enabled: true,
    experimentId: "exp_1",
    variations: [],
    allEnvironments: true,
    ...overrides,
  }) as FeatureRule;

const forceRule = (overrides: Partial<FeatureRule> = {}): FeatureRule =>
  ({
    id: "fr_force",
    type: "force",
    description: "",
    condition: "",
    enabled: true,
    value: "true",
    allEnvironments: true,
    ...overrides,
  }) as FeatureRule;

const feature: FeatureInterface = {
  id: "checkout",
  organization: "org",
  owner: "",
  dateCreated: new Date("2026-01-01"),
  dateUpdated: new Date("2026-01-01"),
  valueType: "boolean",
  defaultValue: "false",
  archived: false,
  description: "",
  version: 1,
  environmentSettings: {
    dev: { enabled: true, rules: [] },
    prod: { enabled: true, rules: [] },
  },
  rules: [forceRule(), experimentRule()],
};

const change = (mutate: (f: FeatureInterface) => void) => {
  const updated = cloneDeep(feature);
  mutate(updated);
  return updated;
};

describe("getChangedExperimentEntities", () => {
  it("lists nothing when only an unrelated rule changed", () => {
    expect(
      getChangedExperimentEntities(
        feature,
        change((f) => (f.rules = [forceRule({ value: "false" }), f.rules![1]])),
        envs,
        envs,
      ),
    ).toEqual([]);
  });

  it("lists the experiment when its own rule changed", () => {
    expect(
      getChangedExperimentEntities(
        feature,
        change(
          (f) => (f.rules = [f.rules![0], experimentRule({ condition: "{}" })]),
        ),
        envs,
        envs,
      ),
    ).toEqual([{ type: "experiment", id: "exp_1", environments: envs }]);
  });

  it("lists the experiment in the environment a toggle switched it off", () => {
    expect(
      getChangedExperimentEntities(
        feature,
        change((f) => (f.environmentSettings.prod.enabled = false)),
        ["prod"],
        envs,
      ),
    ).toEqual([{ type: "experiment", id: "exp_1", environments: ["prod"] }]);
  });

  it("lists nothing for a rule inserted above the experiment", () => {
    expect(
      getChangedExperimentEntities(
        feature,
        change(
          (f) => (f.rules = [forceRule({ id: "fr_new" }), ...(f.rules ?? [])]),
        ),
        envs,
        envs,
      ),
    ).toEqual([]);
  });

  it("lists a disabled experiment rule only when it switches on", () => {
    const off = change((f) => (f.rules = [experimentRule({ enabled: false })]));
    expect(
      getChangedExperimentEntities(
        off,
        change(
          (f) =>
            (f.rules = [experimentRule({ enabled: false, condition: "{}" })]),
        ),
        envs,
        envs,
      ),
    ).toEqual([]);
    expect(
      getChangedExperimentEntities(
        off,
        change((f) => (f.rules = [experimentRule()])),
        envs,
        envs,
      ),
    ).toEqual([{ type: "experiment", id: "exp_1", environments: envs }]);
  });
});

describe("getExperimentReach", () => {
  const scoped = change((f) => {
    f.rules = [
      experimentRule({ allEnvironments: false, environments: ["prod"] }),
    ];
  });
  const disabled = change((f) => {
    f.id = "pricing";
    f.environmentSettings.dev.enabled = false;
    f.environmentSettings.prod.enabled = false;
  });

  it("reaches where its linked flags run it", () => {
    expect(
      getExperimentReach("exp_1", false, [scoped, disabled], scope),
    ).toEqual({
      environments: ["prod"],
      relatedEntities: [
        {
          type: "feature",
          id: "checkout",
          environments: ["prod"],
          projects: [],
          tags: [],
        },
      ],
    });
  });

  it("reaches every environment with visual changes or redirects", () => {
    expect(
      getExperimentReach("exp_1", true, [scoped], scope).environments,
    ).toEqual(envs);
  });
});

describe("getDependentEntities", () => {
  it("lists a flag only where what uses the resource is served", () => {
    const usesGroup = (f: FeatureInterface) =>
      (f.prerequisites ?? []).length > 0 ||
      (f.rules ?? []).some((r) => r.condition.includes("grp_beta"));
    const devRule = forceRule({
      condition: '{"id":{"$inGroup":"grp_beta"}}',
      allEnvironments: false,
      environments: ["dev"],
    });
    const listed = (rules: FeatureRule[], prerequisite = false) =>
      getDependentEntities(
        {
          uses: usesGroup,
          features: [
            change((f) => {
              f.rules = [forceRule({ id: "fr_other" }), ...rules];
              if (prerequisite)
                f.prerequisites = [{ id: "a", condition: "{}" }];
            }),
          ],
        },
        scope,
      ).flatMap((e) => ("environments" in e ? e.environments : []));

    expect(listed([devRule])).toEqual(["dev"]);
    expect(listed([{ ...devRule, enabled: false }])).toEqual([]);
    expect(listed([devRule], true)).toEqual(envs);
  });

  it("lists dependents with their live environments, Projects and tags", () => {
    const devOnly = change((f) => {
      f.id = "banner";
      f.project = "prj_a";
      f.tags = ["marketing"];
      f.environmentSettings.prod.enabled = false;
    });
    expect(
      getDependentEntities(
        {
          uses: () => true,
          features: [devOnly],
          experiments: [
            {
              id: "exp_1",
              project: "prj_b",
              tags: ["checkout"],
              linkedFeatures: ["checkout"],
            },
            { id: "exp_visual", hasVisualChangesets: true },
            { id: "exp_unserved" },
          ],
        },
        scope,
        new Map([["checkout", feature]]),
      ),
    ).toEqual([
      {
        type: "feature",
        id: "banner",
        environments: ["dev"],
        projects: ["prj_a"],
        tags: ["marketing"],
      },
      {
        type: "experiment",
        id: "exp_1",
        environments: envs,
        projects: ["prj_b"],
        tags: ["checkout"],
      },
      {
        type: "experiment",
        id: "exp_visual",
        environments: envs,
        projects: [],
        tags: [],
      },
    ]);
  });
});

describe("dependentsReach", () => {
  it("lists where dependents use it and other payloads change, once, in org order", () => {
    const banner = {
      type: "feature" as const,
      id: "banner",
      environments: ["prod"],
    };
    expect(
      dependentsReach(
        [banner],
        [{ environment: "prod" }, { environment: "dev" }],
        envs,
      ),
    ).toEqual({ environments: ["dev", "prod"], relatedEntities: [banner] });
  });
});

describe("refreshThenReport", () => {
  const org = {
    settings: { environments: [{ id: "dev" }, { id: "prod" }] },
  } as OrganizationInterface;
  const reach: EventReach = { environments: ["prod"], relatedEntities: [] };

  it("reports what the scan found", async () => {
    const onReach = jest.fn().mockResolvedValue(undefined);
    await refreshThenReport(org, async () => reach, onReach);
    expect(onReach).toHaveBeenCalledWith(reach);
  });

  it("reports every environment when the scan falls back or fails", async () => {
    const onReach = jest.fn().mockResolvedValue(undefined);
    await refreshThenReport(org, async () => null, onReach);
    await expect(
      refreshThenReport(
        org,
        async () => {
          throw new Error("scan failed");
        },
        onReach,
      ),
    ).rejects.toThrow("scan failed");
    expect(onReach.mock.calls).toEqual([
      [{ environments: envs, relatedEntities: [] }],
      [{ environments: envs, relatedEntities: [] }],
    ]);
  });
});

describe("scopeRelatedEntities", () => {
  const entities = [
    {
      type: "feature" as const,
      id: "a",
      environments: envs,
      projects: ["prj_a"],
      tags: ["payments"],
    },
    {
      type: "feature" as const,
      id: "b",
      environments: ["dev"],
      projects: ["prj_b"],
      tags: ["payments"],
    },
    {
      type: "feature" as const,
      id: "d",
      environments: envs,
      projects: ["prj_a"],
      tags: ["search"],
    },
    { type: "experiment" as const, id: "c", environments: envs },
  ];

  it("keeps entities in the webhook's Projects and tags, narrowed to its environments", () => {
    expect(
      scopeRelatedEntities(entities, {
        projects: ["prj_a"],
        tags: ["payments"],
        environments: ["prod"],
      }),
    ).toEqual([
      {
        type: "feature",
        id: "a",
        environments: ["prod"],
        projects: ["prj_a"],
        tags: ["payments"],
      },
      { type: "experiment", id: "c", environments: ["prod"] },
    ]);
  });

  it("keeps everything for a webhook without filters", () => {
    expect(scopeRelatedEntities(entities, {})).toEqual(entities);
  });
});
