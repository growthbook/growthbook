import { ApiFeature, ApiFeatureForceRule } from "shared/types/openapi";
import {
  RELEVANT_KEYS_FOR_ALL_ENVS,
  getChangedApiFeatureEnvironments,
} from "back-end/src/events/handlers/utils";

describe("getChangedApiFeatureEnvironments", () => {
  const rule: ApiFeatureForceRule = {
    description: "",
    enabled: true,
    condition: "",
    id: "",
    type: "force",
    value: "true",
  };
  const feature: ApiFeature = {
    archived: false,
    defaultValue: "default",
    environments: {
      dev: { enabled: true, defaultValue: "false", rules: [{ ...rule }] },
      prod: { enabled: true, defaultValue: "false", rules: [{ ...rule }] },
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

  it("returns all envs when a global field changes", () => {
    const values = RELEVANT_KEYS_FOR_ALL_ENVS.map((key) =>
      getChangedApiFeatureEnvironments(feature, {
        ...feature,
        [key]: key === "archived" ? !feature.archived : "new-value",
      }),
    );

    values.forEach((v) => expect(v).toEqual(["dev", "prod"]));
  });

  it("returns the specific env that changed", () => {
    expect(
      getChangedApiFeatureEnvironments(feature, {
        ...feature,
        environments: {
          ...feature.environments,
          prod: {
            ...feature.environments["prod"],
            enabled: !feature.environments["prod"]?.enabled,
          } as ApiFeature["environments"][string],
        },
      }),
    ).toEqual(["prod"]);
  });

  it("returns no envs when nothing has changed", () => {
    expect(getChangedApiFeatureEnvironments(feature, feature)).toEqual([]);
  });

  it("returns false when a filtered environment is disabled before and after the event", () => {
    function getFeatureToTest(enabled: 0 | 1, defaultValue: 0 | 1): ApiFeature {
      return {
        ...feature,
        environments: {
          dev: {
            ...feature.environments.dev,
            enabled: enabled === 1,
            defaultValue: defaultValue === 1 ? "true" : "false",
          } as ApiFeature["environments"][string],
          prod: {
            ...feature.environments.prod,
            enabled: enabled === 1,
            defaultValue: defaultValue === 1 ? "true" : "false",
          } as ApiFeature["environments"][string],
        },
      };
    }

    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(0, 0),
        getFeatureToTest(0, 0),
      ),
    ).toEqual([]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(0, 0),
        getFeatureToTest(0, 1),
      ),
    ).toEqual([]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(0, 0),
        getFeatureToTest(1, 0),
      ),
    ).toEqual(["dev", "prod"]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(0, 0),
        getFeatureToTest(1, 1),
      ),
    ).toEqual(["dev", "prod"]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(0, 1),
        getFeatureToTest(0, 0),
      ),
    ).toEqual([]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(0, 1),
        getFeatureToTest(0, 1),
      ),
    ).toEqual([]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(0, 1),
        getFeatureToTest(1, 1),
      ),
    ).toEqual(["dev", "prod"]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(1, 0),
        getFeatureToTest(0, 0),
      ),
    ).toEqual(["dev", "prod"]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(1, 0),
        getFeatureToTest(0, 1),
      ),
    ).toEqual(["dev", "prod"]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(1, 0),
        getFeatureToTest(1, 0),
      ),
    ).toEqual([]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(1, 0),
        getFeatureToTest(1, 1),
      ),
    ).toEqual(["dev", "prod"]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(1, 1),
        getFeatureToTest(0, 0),
      ),
    ).toEqual(["dev", "prod"]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(1, 1),
        getFeatureToTest(0, 1),
      ),
    ).toEqual(["dev", "prod"]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(1, 1),
        getFeatureToTest(1, 0),
      ),
    ).toEqual(["dev", "prod"]);
    expect(
      getChangedApiFeatureEnvironments(
        getFeatureToTest(1, 1),
        getFeatureToTest(1, 1),
      ),
    ).toEqual([]);
  });
});
