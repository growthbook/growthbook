import cloneDeep from "lodash/cloneDeep";
import { MetricInterface } from "../types/metric";
import {
  upgradeDatasourceObject,
  upgradeFeatureInterface,
  upgradeFeatureRule,
  upgradeMetricDoc,
} from "../src/util/migrations";
import { DataSourceInterface, DataSourceSettings } from "../types/datasource";
import { encryptParams } from "../src/services/datasource";
import { MixpanelConnectionParams } from "../types/integrations/mixpanel";
import { PostgresConnectionParams } from "../types/integrations/postgres";
import {
  ExperimentRule,
  FeatureInterface,
  FeatureRule,
  LegacyFeatureInterface,
} from "../types/feature";

describe("backend", () => {
  it("updates old metric objects - earlyStart", () => {
    const baseMetric: MetricInterface = {
      datasource: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "",
      id: "",
      ignoreNulls: false,
      inverse: false,
      name: "",
      organization: "",
      owner: "",
      queries: [],
      runStarted: null,
      type: "binomial",
      userIdColumns: {
        user_id: "user_id",
        anonymous_id: "anonymous_id",
      },
      userIdTypes: ["anonymous_id", "user_id"],
    };

    const earlyStartNoConversionWindow: MetricInterface = {
      ...baseMetric,
      earlyStart: true,
    };
    expect(upgradeMetricDoc(earlyStartNoConversionWindow)).toEqual({
      ...earlyStartNoConversionWindow,
      conversionDelayHours: -0.5,
      conversionWindowHours: 72.5,
    });

    const earlyStartConversionWindow: MetricInterface = {
      ...baseMetric,
      earlyStart: true,
      conversionWindowHours: 50,
    };
    expect(upgradeMetricDoc(earlyStartConversionWindow)).toEqual({
      ...earlyStartNoConversionWindow,
      conversionDelayHours: -0.5,
      conversionWindowHours: 50.5,
    });

    const earlyStartConversionDelay: MetricInterface = {
      ...baseMetric,
      earlyStart: true,
      conversionDelayHours: 5,
      conversionWindowHours: 50,
    };
    expect(upgradeMetricDoc(earlyStartConversionDelay)).toEqual({
      ...earlyStartConversionDelay,
    });
  });

  it("updates old metric objects - userIdType", () => {
    const baseMetric: MetricInterface = {
      datasource: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "",
      id: "",
      ignoreNulls: false,
      inverse: false,
      name: "",
      organization: "",
      owner: "",
      queries: [],
      runStarted: null,
      type: "binomial",
    };

    const userId: MetricInterface = {
      ...baseMetric,
      userIdType: "user",
    };
    expect(upgradeMetricDoc(userId)).toEqual({
      ...userId,
      userIdTypes: ["user_id"],
      userIdColumns: {
        user_id: "user_id",
      },
    });

    const anonymousId: MetricInterface = {
      ...baseMetric,
      userIdType: "anonymous",
    };
    expect(upgradeMetricDoc(anonymousId)).toEqual({
      ...anonymousId,
      userIdTypes: ["anonymous_id"],
      userIdColumns: {
        anonymous_id: "anonymous_id",
      },
    });

    const either: MetricInterface = {
      ...baseMetric,
      userIdType: "either",
    };
    expect(upgradeMetricDoc(either)).toEqual({
      ...either,
      userIdTypes: ["anonymous_id", "user_id"],
      userIdColumns: {
        user_id: "user_id",
        anonymous_id: "anonymous_id",
      },
    });

    const userIdTypesAlreadyDefined: MetricInterface = {
      ...baseMetric,
      userIdType: "either",
      userIdTypes: ["blah"],
    };
    expect(upgradeMetricDoc(userIdTypesAlreadyDefined)).toEqual({
      ...userIdTypesAlreadyDefined,
      userIdColumns: {
        blah: "blah",
      },
    });
  });

  it("updates old metric objects - userIdColumns", () => {
    const baseMetric: MetricInterface = {
      datasource: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "",
      id: "",
      ignoreNulls: false,
      inverse: false,
      name: "",
      organization: "",
      owner: "",
      queries: [],
      runStarted: null,
      type: "binomial",
      userIdTypes: ["anonymous_id", "user_id"],
    };

    const userIdCol: MetricInterface = {
      ...baseMetric,
      userIdColumn: "foo",
    };
    expect(upgradeMetricDoc(userIdCol)).toEqual({
      ...userIdCol,
      userIdColumns: {
        user_id: "foo",
        anonymous_id: "anonymous_id",
      },
    });

    const anonymousIdCol: MetricInterface = {
      ...baseMetric,
      anonymousIdColumn: "foo",
    };
    expect(upgradeMetricDoc(anonymousIdCol)).toEqual({
      ...anonymousIdCol,
      userIdColumns: {
        user_id: "user_id",
        anonymous_id: "foo",
      },
    });

    const userIdColumnsAlreadyDefined: MetricInterface = {
      ...baseMetric,
      userIdColumn: "foo",
      anonymousIdColumn: "bar",
      userIdColumns: {
        user_id: "userid",
        anonymous_id: "anonid",
      },
    };
    expect(upgradeMetricDoc(userIdColumnsAlreadyDefined)).toEqual({
      ...userIdColumnsAlreadyDefined,
    });
  });

  it("updates old datasource objects - userIdTypes", () => {
    const baseDatasource: DataSourceInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      id: "",
      name: "",
      organization: "",
      params: encryptParams({
        projectId: "",
        secret: "",
        username: "",
      } as MixpanelConnectionParams),
      settings: {},
      type: "mixpanel",
    };

    const noUserIdTypes: DataSourceSettings = {};
    expect(
      upgradeDatasourceObject({
        ...baseDatasource,
        settings: { ...noUserIdTypes },
      }).settings
    ).toEqual({
      userIdTypes: [
        {
          userIdType: "user_id",
          description: "Logged-in user id",
        },
        {
          userIdType: "anonymous_id",
          description: "Anonymous visitor id",
        },
      ],
    });

    const userIdTypes: DataSourceSettings = {
      userIdTypes: [
        {
          userIdType: "foo",
          description: "",
        },
      ],
    };
    expect(
      upgradeDatasourceObject({
        ...baseDatasource,
        settings: { ...userIdTypes },
      }).settings
    ).toEqual({
      ...userIdTypes,
    });
  });

  it("updates old datasource objects - experimentQuery", () => {
    const ds: DataSourceInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      id: "",
      name: "",
      organization: "",
      params: encryptParams({
        database: "",
        defaultSchema: "",
        host: "",
        password: "",
        port: 123,
        ssl: false,
        user: "",
      } as PostgresConnectionParams),
      settings: {
        userIdTypes: [
          {
            userIdType: "user_id",
            description: "Logged-in user id",
          },
          {
            userIdType: "anonymous_id",
            description: "Anonymous visitor id",
          },
        ],
        experimentDimensions: ["foo"],
        queries: {
          experimentsQuery: "testing",
        },
      },
      type: "postgres",
    };

    expect(upgradeDatasourceObject(cloneDeep(ds)).settings).toEqual({
      ...ds.settings,
      queries: {
        experimentsQuery: "testing",
        exposure: [
          {
            id: "user_id",
            description: "",
            dimensions: ["foo"],
            name: "Logged-in User Experiments",
            query: "testing",
            userIdType: "user_id",
          },
          {
            id: "anonymous_id",
            description: "",
            dimensions: ["foo"],
            name: "Anonymous Visitor Experiments",
            query: "testing",
            userIdType: "anonymous_id",
          },
        ],
      },
    });
  });

  it("updates old datasource objects - no experiment query", () => {
    const ds: DataSourceInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      id: "",
      name: "",
      organization: "",
      params: encryptParams({
        database: "",
        defaultSchema: "test",
        host: "",
        password: "",
        port: 123,
        ssl: false,
        user: "",
      } as PostgresConnectionParams),
      settings: {
        userIdTypes: [
          {
            userIdType: "user_id",
            description: "Logged-in user id",
          },
          {
            userIdType: "anonymous_id",
            description: "Anonymous visitor id",
          },
        ],
      },
      type: "postgres",
    };

    expect(upgradeDatasourceObject(cloneDeep(ds)).settings).toEqual({
      ...ds.settings,
      queries: {
        exposure: [
          {
            id: "user_id",
            description: "",
            dimensions: [],
            name: "Logged-in User Experiments",
            query:
              "SELECT\n  user_id as user_id,\n  received_at as timestamp,\n  experiment_id as experiment_id,\n  variation_id as variation_id\nFROM \n  test.experiment_viewed",
            userIdType: "user_id",
          },
          {
            id: "anonymous_id",
            description: "",
            dimensions: [],
            name: "Anonymous Visitor Experiments",
            query:
              "SELECT\n  anonymous_id as anonymous_id,\n  received_at as timestamp,\n  experiment_id as experiment_id,\n  variation_id as variation_id\nFROM \n  test.experiment_viewed",
            userIdType: "anonymous_id",
          },
        ],
      },
    });
  });

  it("updates old feature objects", () => {
    const rule: FeatureRule = {
      id: "fr_123",
      type: "force",
      value: "false",
      description: "",
    };

    const origFeature: LegacyFeatureInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organization: "",
      owner: "",
      defaultValue: "true",
      valueType: "boolean",
      id: "",
    };

    expect(
      upgradeFeatureInterface({
        ...origFeature,
        environments: ["dev"],
        rules: [rule],
      })
    ).toEqual({
      ...origFeature,
      environmentSettings: {
        dev: {
          enabled: true,
          rules: [rule],
        },
        production: {
          enabled: false,
          rules: [rule],
        },
      },
    });
  });

  it("doesn't overwrite new feature objects", () => {
    const origFeature: LegacyFeatureInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organization: "",
      owner: "",
      defaultValue: "true",
      valueType: "boolean",
      id: "",
      environmentSettings: {
        dev: {
          enabled: false,
          rules: [],
        },
        production: {
          enabled: true,
          rules: [
            {
              id: "fr_1234",
              type: "force",
              value: "true",
              description: "",
            },
          ],
        },
      },
    };

    expect(
      upgradeFeatureInterface({
        ...origFeature,
        environments: ["dev"],
        rules: [
          {
            id: "fr_123",
            type: "force",
            value: "false",
            description: "",
          },
        ],
      })
    ).toEqual(origFeature);
  });

  it("keeps drafts when default value changed", () => {
    const origFeature: LegacyFeatureInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organization: "",
      owner: "",
      defaultValue: "true",
      valueType: "boolean",
      id: "",
      environmentSettings: {
        dev: {
          enabled: false,
          rules: [],
        },
        production: {
          enabled: true,
          rules: [
            {
              id: "fr_1234",
              type: "force",
              value: "true",
              description: "",
            },
          ],
        },
      },
      draft: {
        active: true,
        defaultValue: "false",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        rules: {
          production: [
            {
              id: "fr_1234",
              type: "force",
              value: "true",
              description: "",
            },
          ],
        },
      },
    };

    expect(upgradeFeatureInterface(cloneDeep(origFeature))).toEqual(
      origFeature
    );
  });

  it("keeps drafts when rules changed", () => {
    const origFeature: LegacyFeatureInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organization: "",
      owner: "",
      defaultValue: "true",
      valueType: "boolean",
      id: "",
      environmentSettings: {
        dev: {
          enabled: false,
          rules: [],
        },
        production: {
          enabled: true,
          rules: [
            {
              id: "fr_1234",
              type: "force",
              value: "true",
              description: "",
            },
          ],
        },
      },
      draft: {
        active: true,
        defaultValue: "true",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        rules: {
          production: [
            {
              id: "fr_1234",
              type: "force",
              value: "false",
              description: "",
            },
          ],
        },
      },
    };

    expect(upgradeFeatureInterface(cloneDeep(origFeature))).toEqual(
      origFeature
    );
  });

  it("discards drafts when nothing is changed", () => {
    const origFeature: LegacyFeatureInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organization: "",
      owner: "",
      defaultValue: "true",
      valueType: "boolean",
      id: "",
      environmentSettings: {
        dev: {
          enabled: false,
          rules: [],
        },
        production: {
          enabled: true,
          rules: [
            {
              id: "fr_1234",
              type: "force",
              value: "true",
              description: "",
            },
          ],
        },
      },
      draft: {
        active: true,
        defaultValue: "true",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        rules: {
          production: [
            {
              id: "fr_1234",
              type: "force",
              value: "true",
              description: "",
            },
          ],
        },
      },
    };

    expect(upgradeFeatureInterface(cloneDeep(origFeature))).toEqual({
      ...origFeature,
      draft: {
        active: false,
      },
    });
  });

  it("migrates old feature rules", () => {
    const origRule: ExperimentRule = {
      type: "experiment",
      description: "",
      hashAttribute: "id",
      id: "123",
      trackingKey: "",
      values: [
        {
          value: "a",
          weight: 0.1,
        },
        {
          value: "b",
          weight: 0.4,
        },
      ],
    };

    expect(upgradeFeatureRule(cloneDeep(origRule))).toEqual({
      ...origRule,
      coverage: 0.5,
      values: [
        {
          value: "a",
          weight: 0.2,
        },
        {
          value: "b",
          weight: 0.8,
        },
      ],
    });

    origRule.values[0].weight = 0.9;
    origRule.values[1].weight = 0.3;
    expect(upgradeFeatureRule(cloneDeep(origRule))).toEqual({
      ...origRule,
      coverage: 1,
      values: [
        {
          value: "a",
          weight: 0.75,
        },
        {
          value: "b",
          weight: 0.25,
        },
      ],
    });

    origRule.values[0].weight = 0;
    origRule.values[1].weight = 0.5;
    expect(upgradeFeatureRule(cloneDeep(origRule))).toEqual({
      ...origRule,
      coverage: 0.5,
      values: [
        {
          value: "a",
          weight: 0,
        },
        {
          value: "b",
          weight: 1,
        },
      ],
    });

    origRule.values[0].weight = 0.4;
    origRule.values[1].weight = 0.6;
    expect(upgradeFeatureRule(cloneDeep(origRule))).toEqual({
      ...origRule,
      coverage: 1,
      values: [
        {
          value: "a",
          weight: 0.4,
        },
        {
          value: "b",
          weight: 0.6,
        },
      ],
    });

    origRule.values[0].weight = 0.4;
    origRule.values[1].weight = 0.6;
    origRule.coverage = 0.5;
    expect(upgradeFeatureRule(cloneDeep(origRule))).toEqual({
      ...origRule,
    });
  });

  it("upgrades all rules", () => {
    const origRule: ExperimentRule = {
      type: "experiment",
      description: "",
      hashAttribute: "id",
      id: "123",
      trackingKey: "",
      values: [
        {
          value: "a",
          weight: 0.1,
        },
        {
          value: "b",
          weight: 0.4,
        },
      ],
    };
    const newRule = {
      ...origRule,
      coverage: 0.5,
      values: [
        {
          value: "a",
          weight: 0.2,
        },
        {
          value: "b",
          weight: 0.8,
        },
      ],
    };

    const origFeature: FeatureInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organization: "",
      owner: "",
      defaultValue: "true",
      valueType: "boolean",
      id: "",
      environmentSettings: {
        prod: {
          enabled: true,
          rules: [origRule],
        },
        test: {
          enabled: true,
          rules: [origRule],
        },
      },
      draft: {
        active: true,
        rules: {
          dev: [origRule],
        },
      },
    };

    const newFeature = upgradeFeatureInterface(cloneDeep(origFeature));

    if (!newFeature.environmentSettings)
      throw new Error("newFeature.environmentSettings is undefined");
    if (!newFeature.draft) throw new Error("newFeature.draft is undefined");
    if (!newFeature.draft.rules)
      throw new Error("newFeature.draft.rules is undefined");

    expect(newFeature.environmentSettings["prod"].rules[0]).toEqual(newRule);
    expect(newFeature.environmentSettings["test"].rules[0]).toEqual(newRule);
    expect(newFeature.draft.rules["dev"][0]).toEqual(newRule);
  });
});
