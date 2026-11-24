import cloneDeep from "lodash/cloneDeep";
import { ApiFeature, ApiFeatureForceRule } from "shared/validators";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { deriveLiveFeatureEventEnvironments } from "back-end/src/events/eventEnvironments";
import { getChangedFeatureEnvironments } from "back-end/src/util/features";

const envs = ["dev", "prod"];

const forceRule = (overrides: Partial<FeatureRule> = {}): FeatureRule =>
  ({
    id: "fr_1",
    type: "force",
    description: "",
    condition: "",
    enabled: true,
    value: "true",
    allEnvironments: true,
    ...overrides,
  }) as FeatureRule;

const baseFeature: FeatureInterface = {
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
  tags: ["payments"],
  customFields: { "datadog-service": ["checkout-api"] },
  environmentSettings: {
    dev: { enabled: true, rules: [] },
    prod: { enabled: true, rules: [] },
  },
  rules: [forceRule()],
};

const change = (mutate: (f: FeatureInterface) => void) => {
  const updated = cloneDeep(baseFeature);
  mutate(updated);
  return updated;
};

describe("getChangedFeatureEnvironments", () => {
  it("returns no environments for a description-only change", () => {
    expect(
      getChangedFeatureEnvironments(
        baseFeature,
        change((f) => (f.description = "New copy")),
        envs,
      ),
    ).toEqual([]);
  });

  it.each([
    ["defaultValue", (f: FeatureInterface) => (f.defaultValue = "true")],
    ["archived", (f: FeatureInterface) => (f.archived = true)],
    ["project", (f: FeatureInterface) => (f.project = "prj_1")],
    [
      "targetingProjects",
      (f: FeatureInterface) => (f.targetingProjects = ["prj_2"]),
    ],
    [
      "holdout",
      (f: FeatureInterface) => (f.holdout = { id: "hld_1", value: "false" }),
    ],
  ])("returns every enabled environment when %s changes", (_, mutate) => {
    expect(
      getChangedFeatureEnvironments(baseFeature, change(mutate), envs),
    ).toEqual(envs);
  });

  it("skips environments disabled before and after a feature-wide change", () => {
    const original = change(
      (f) => (f.environmentSettings.prod.enabled = false),
    );
    expect(
      getChangedFeatureEnvironments(
        original,
        change((f) => {
          f.environmentSettings.prod.enabled = false;
          f.defaultValue = "true";
        }),
        envs,
      ),
    ).toEqual(["dev"]);
  });

  it("returns only the environments a changed rule applies to", () => {
    const original = change((f) => {
      f.rules = [forceRule({ allEnvironments: false, environments: ["prod"] })];
    });
    expect(
      getChangedFeatureEnvironments(
        original,
        change((f) => {
          f.rules = [
            forceRule({
              allEnvironments: false,
              environments: ["prod"],
              value: "false",
            }),
          ];
        }),
        envs,
      ),
    ).toEqual(["prod"]);
  });

  it("returns the environment that was toggled", () => {
    expect(
      getChangedFeatureEnvironments(
        baseFeature,
        change((f) => (f.environmentSettings.dev.enabled = false)),
        envs,
      ),
    ).toEqual(["dev"]);
  });

  it("returns nothing for a feature archived before and after", () => {
    const archived = change((f) => (f.archived = true));
    expect(
      getChangedFeatureEnvironments(
        archived,
        change((f) => {
          f.archived = true;
          f.defaultValue = "true";
        }),
        envs,
      ),
    ).toEqual([]);
  });

  it("counts a tag change only where an SDK connection embeds tags", () => {
    const retagged = change((f) => (f.tags = ["payments", "beta"]));
    expect(getChangedFeatureEnvironments(baseFeature, retagged, envs)).toEqual(
      [],
    );
    expect(
      getChangedFeatureEnvironments(baseFeature, retagged, envs, [
        { environment: "dev", tags: true, customFields: [] },
        { environment: "prod", tags: false, customFields: [] },
      ]),
    ).toEqual(["dev"]);
  });

  it("counts a custom field change only when that field is embedded", () => {
    const updated = change(
      (f) => (f.customFields = { "datadog-service": ["checkout-web"] }),
    );
    expect(
      getChangedFeatureEnvironments(baseFeature, updated, envs, [
        { environment: "prod", tags: true, customFields: ["owner-team"] },
      ]),
    ).toEqual([]);
    expect(
      getChangedFeatureEnvironments(baseFeature, updated, envs, [
        { environment: "prod", tags: false, customFields: ["datadog-service"] },
      ]),
    ).toEqual(["prod"]);
  });
});

describe("deriveLiveFeatureEventEnvironments", () => {
  const rule: ApiFeatureForceRule = {
    description: "",
    enabled: true,
    condition: "",
    id: "",
    type: "force",
    value: "true",
  };
  const apiFeature: ApiFeature = {
    archived: false,
    defaultValue: "default",
    environments: {
      dev: { enabled: true, defaultValue: "false", rules: [{ ...rule }] },
      prod: { enabled: false, defaultValue: "false", rules: [{ ...rule }] },
    },
    prerequisites: [],
    project: "project",
    valueType: "string",
    dateCreated: new Date().toISOString(),
    dateUpdated: new Date().toISOString(),
    description: "",
    id: "id",
    owner: "",
    revision: {
      comment: "",
      date: new Date().toISOString(),
      publishedBy: "",
      version: 1,
    },
    tags: [],
  };

  it("uses enabled envs when there is no previous snapshot (created)", () => {
    expect(deriveLiveFeatureEventEnvironments({ current: apiFeature })).toEqual(
      ["dev"],
    );
  });

  it("uses all configured envs for deletions", () => {
    expect(
      deriveLiveFeatureEventEnvironments({
        current: apiFeature,
        deleted: true,
      }),
    ).toEqual(["dev", "prod"]);
  });
});
