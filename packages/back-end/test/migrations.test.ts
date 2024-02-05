/* eslint-disable @typescript-eslint/no-explicit-any */

import cloneDeep from "lodash/cloneDeep";
import {
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import omit from "lodash/omit";
import { LegacyMetricInterface } from "../types/metric";
import {
  migrateSavedGroup,
  migrateSnapshot,
  upgradeDatasourceObject,
  upgradeExperimentDoc,
  upgradeFeatureInterface,
  upgradeFeatureRule,
  upgradeMetricDoc,
  upgradeOrganizationDoc,
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
import { OrganizationInterface } from "../types/organization";
import {
  ExperimentSnapshotInterface,
  LegacyExperimentSnapshotInterface,
} from "../types/experiment-snapshot";
import { ExperimentReportResultDimension } from "../types/report";
import { Queries } from "../types/query";
import { ExperimentPhase } from "../types/experiment";
import { LegacySavedGroupInterface } from "../types/saved-group";

describe("Metric Migration", () => {
  it("updates old metric objects - earlyStart and conversion*Hours", () => {
    const baseMetric: LegacyMetricInterface = {
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
      cappingSettings: {
        type: "",
        value: 0,
      },
      userIdTypes: ["anonymous_id", "user_id"],
    };

    const earlyStartNoConversionWindow: LegacyMetricInterface = {
      ...baseMetric,
      earlyStart: true,
    };
    expect(upgradeMetricDoc(earlyStartNoConversionWindow)).toEqual({
      ...earlyStartNoConversionWindow,
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 72.5,
        delayHours: -0.5,
      },
    });

    const earlyStartConversionWindow: LegacyMetricInterface = {
      ...baseMetric,
      earlyStart: true,
      conversionWindowHours: 50,
    };
    expect(upgradeMetricDoc(earlyStartConversionWindow)).toEqual({
      ...baseMetric,
      earlyStart: true,
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 50.5,
        delayHours: -0.5,
      },
    });

    const earlyStartConversionDelay: LegacyMetricInterface = {
      ...baseMetric,
      earlyStart: true,
      conversionDelayHours: 5,
      conversionWindowHours: 50,
    };
    expect(upgradeMetricDoc(earlyStartConversionDelay)).toEqual({
      ...baseMetric,
      earlyStart: true,
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 50,
        delayHours: 5,
      },
    });

    const conversionWindow: LegacyMetricInterface = {
      ...baseMetric,
      conversionDelayHours: 5,
      conversionWindowHours: 50,
    };
    expect(upgradeMetricDoc(conversionWindow)).toEqual({
      ...baseMetric,
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 50,
        delayHours: 5,
      },
    });
    const conversionWindowAndSettings: LegacyMetricInterface = {
      ...baseMetric,
      conversionDelayHours: 5,
      conversionWindowHours: 50,
      windowSettings: {
        type: "lookback",
        windowUnit: "days",
        windowValue: 33,
        delayHours: 3,
      },
    };
    expect(upgradeMetricDoc(conversionWindowAndSettings)).toEqual({
      ...baseMetric,
      windowSettings: {
        type: "lookback",
        windowUnit: "days",
        windowValue: 33,
        delayHours: 3,
      },
    });
  });

  it("updates old metric objects - cap and capping", () => {
    const baseMetric: LegacyMetricInterface = {
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
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 72,
        delayHours: 0,
      },
      userIdTypes: ["anonymous_id", "user_id"],
    };

    const capMetric: LegacyMetricInterface = {
      ...baseMetric,
      cap: 35,
    };

    expect(upgradeMetricDoc(capMetric)).toEqual({
      ...baseMetric,
      cappingSettings: {
        type: "absolute",
        value: 35,
      },
    });

    const capZeroMetric: LegacyMetricInterface = {
      ...baseMetric,
      cap: 0,
    };

    expect(upgradeMetricDoc(capZeroMetric)).toEqual({
      ...baseMetric,
      cappingSettings: {
        type: "",
        value: 0,
      },
    });

    const cappingMetric: LegacyMetricInterface = {
      ...baseMetric,
      capping: "percentile",
      capValue: 0.99,
      cap: 35,
    };

    expect(upgradeMetricDoc(cappingMetric)).toEqual({
      ...baseMetric,
      cappingSettings: {
        type: "percentile",
        value: 0.99,
      },
    });
  });

  it("doesn't overwrite new capping settings", () => {
    const baseMetric: LegacyMetricInterface = {
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
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 72,
        delayHours: 0,
      },
      userIdTypes: ["anonymous_id", "user_id"],
    };

    expect(
      upgradeMetricDoc({
        ...baseMetric,
        capping: "percentile",
        capValue: 0.99,
        cap: 35,
      })
    ).toEqual({
      ...baseMetric,
      cappingSettings: {
        type: "percentile",
        value: 0.99,
      },
    });

    expect(
      upgradeMetricDoc({ ...baseMetric, capping: "", capValue: 0.99, cap: 35 })
    ).toEqual({
      ...baseMetric,
      cappingSettings: {
        type: "",
        value: 0.99,
      },
    });

    expect(
      upgradeMetricDoc({
        ...baseMetric,
        cappingSettings: { type: "percentile", value: 0.95 },
        capValue: 0.99,
        capping: "absolute",
        cap: 35,
      })
    ).toEqual({
      ...baseMetric,
      cappingSettings: {
        type: "percentile",
        value: 0.95,
      },
    });
  });

  it("updates old metric objects - userIdType", () => {
    const baseMetric: LegacyMetricInterface = {
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
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 72,
        delayHours: 0,
      },
      cappingSettings: {
        type: "",
        value: 0,
      },
    };

    const userId: LegacyMetricInterface = {
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

    const anonymousId: LegacyMetricInterface = {
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

    const either: LegacyMetricInterface = {
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

    const userIdTypesAlreadyDefined: LegacyMetricInterface = {
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
    const baseMetric: LegacyMetricInterface = {
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
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 72,
        delayHours: 0,
      },
      cappingSettings: {
        type: "",
        value: 0,
      },
    };

    const userIdCol: LegacyMetricInterface = {
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

    const anonymousIdCol: LegacyMetricInterface = {
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

    const userIdColumnsAlreadyDefined: LegacyMetricInterface = {
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
});

describe("Datasource Migration", () => {
  it("updates old datasource objects - userIdTypes", () => {
    const baseDatasource: DataSourceInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      id: "",
      description: "",
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
      description: "",
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
      description: "",
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
});

describe("Feature Migration", () => {
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
      organization: "org_123",
      owner: "",
      defaultValue: "true",
      valueType: "boolean",
      id: "test",
      revision: {
        comment: "",
        date: new Date(),
        publishedBy: { email: "", id: "", name: "" },
        version: 8,
      },
      draft: {
        active: true,
        defaultValue: "false",
      },
    } as any;

    const expected: FeatureInterface = {
      ...omit(origFeature, ["draft", "revision"]),
      version: 8,
      legacyDraft: {
        baseVersion: 8,
        comment: "",
        dateCreated: origFeature.dateCreated,
        datePublished: null,
        dateUpdated: origFeature.dateUpdated,
        defaultValue: "false",
        featureId: "test",
        organization: "org_123",
        createdBy: null,
        publishedBy: null,
        rules: {
          dev: [rule],
          production: [rule],
        },
        status: "draft",
        version: 9,
      },
      hasDrafts: true,
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
    };

    expect(
      upgradeFeatureInterface({
        ...origFeature,
        environments: ["dev"],
        rules: [rule],
      })
    ).toEqual(expected);
  });

  it("doesn't overwrite new feature objects", () => {
    const origFeature: LegacyFeatureInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organization: "",
      version: 1,
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

  it("discards drafts when nothing is changed", () => {
    const origFeature: LegacyFeatureInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organization: "",
      owner: "",
      defaultValue: "true",
      valueType: "boolean",
      id: "",
      version: 1,
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
      draft: undefined,
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
      version: 1,
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
    };

    const newFeature = upgradeFeatureInterface(cloneDeep(origFeature));

    if (!newFeature.environmentSettings)
      throw new Error("newFeature.environmentSettings is undefined");
    expect(newFeature.environmentSettings["prod"].rules[0]).toEqual(newRule);
    expect(newFeature.environmentSettings["test"].rules[0]).toEqual(newRule);
  });
});

describe("Experiment Migration", () => {
  const exp: any = {
    trackingKey: "test",
    attributionModel: "allExposures",
    variations: [
      {
        screenshots: [],
        name: "",
      },
      {
        screenshots: [],
      },
      {
        id: "foo",
        key: "bar",
        name: "Baz",
        screenshots: [],
      },
    ],
    phases: [
      {
        phase: "main",
      },
      {
        phase: "main",
        name: "New Name",
      },
    ],
  };

  const upgraded = {
    trackingKey: "test",
    hashAttribute: "",
    hashVersion: 2,
    releasedVariationId: "",
    attributionModel: "experimentDuration",
    variations: [
      {
        id: "0",
        key: "0",
        name: "Control",
        screenshots: [],
      },
      {
        id: "1",
        key: "1",
        name: "Variation 1",
        screenshots: [],
      },
      {
        id: "foo",
        key: "bar",
        name: "Baz",
        screenshots: [],
      },
    ],
    phases: [
      {
        phase: "main",
        name: "Main",
        condition: "",
        coverage: 1,
        seed: "test",
        namespace: {
          enabled: false,
          name: "",
          range: [0, 1],
        },
      },
      {
        phase: "main",
        name: "New Name",
        condition: "",
        coverage: 1,
        seed: "test",
        namespace: {
          enabled: false,
          name: "",
          range: [0, 1],
        },
      },
    ],
    sequentialTestingEnabled: false,
    sequentialTestingTuningParameter: DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  };

  it("upgrades experiment objects", () => {
    expect(upgradeExperimentDoc(exp)).toEqual(upgraded);
  });
  it("upgrades stopped experiments with results", () => {
    expect(
      upgradeExperimentDoc({
        ...exp,
        status: "stopped",
        results: "dnf",
      })
    ).toEqual({
      ...upgraded,
      status: "stopped",
      results: "dnf",
    });
  });
  it("sets releasedVariationId to `0` for lost experiments", () => {
    expect(
      upgradeExperimentDoc({
        ...exp,
        status: "stopped",
        results: "lost",
      })
    ).toEqual({
      ...upgraded,
      status: "stopped",
      results: "lost",
      releasedVariationId: "0",
    });
  });
  it("sets releasedVariationId to `1` for won experiments", () => {
    expect(
      upgradeExperimentDoc({
        ...exp,
        status: "stopped",
        results: "won",
      })
    ).toEqual({
      ...upgraded,
      status: "stopped",
      results: "won",
      releasedVariationId: "1",
    });
  });
  it("Uses `winner` to set releasedVariationId", () => {
    expect(
      upgradeExperimentDoc({
        ...exp,
        status: "stopped",
        results: "won",
        winner: 2,
      })
    ).toEqual({
      ...upgraded,
      status: "stopped",
      results: "won",
      winner: 2,
      releasedVariationId: "foo",
    });
  });
  it("Doesn't overwrite other attribution models", () => {
    expect(
      upgradeExperimentDoc({
        ...exp,
        attributionModel: "firstExposure",
      })
    ).toEqual({
      ...upgraded,
      attributionModel: "firstExposure",
    });
  });
  it("Fixes namespaces that are missing range and name", () => {
    expect(
      upgradeExperimentDoc({
        ...exp,
        phases: [
          ...exp.phases.map((p: ExperimentPhase, i: number) => {
            return {
              ...p,
              namespace: i
                ? { enabled: true }
                : { enabled: true, name: "test", range: [0.1, 0.2] },
            };
          }),
        ],
      })
    ).toEqual({
      ...upgraded,
      phases: [
        ...upgraded.phases.map((p, i) => {
          return {
            ...p,
            namespace: i
              ? { enabled: false, name: "", range: [0, 1] }
              : { enabled: true, name: "test", range: [0.1, 0.2] },
          };
        }),
      ],
    });
  });
});

describe("Organization Migration", () => {
  it("Upgrades old Organization objects", () => {
    const org: OrganizationInterface = {
      dateCreated: new Date(),
      id: "",
      invites: [],
      members: [],
      name: "",
      ownerEmail: "",
      url: "",
    };

    expect(
      upgradeOrganizationDoc({
        ...org,
      })
    ).toEqual({
      ...org,
      settings: {
        attributeSchema: [
          { property: "id", datatype: "string", hashAttribute: true },
          { property: "deviceId", datatype: "string", hashAttribute: true },
          { property: "company", datatype: "string", hashAttribute: true },
          { property: "loggedIn", datatype: "boolean" },
          { property: "employee", datatype: "boolean" },
          { property: "country", datatype: "string" },
          { property: "browser", datatype: "string" },
          { property: "url", datatype: "string" },
        ],
        defaultRole: {
          role: "collaborator",
          environments: [],
          limitAccessByEnvironment: false,
        },
        statsEngine: DEFAULT_STATS_ENGINE,
        environments: [
          {
            id: "dev",
            description: "",
            toggleOnList: true,
          },
          {
            id: "production",
            description: "",
            toggleOnList: true,
          },
        ],
      },
    });
  });
});

describe("Snapshot Migration", () => {
  it("upgrades legacy snapshot instances", () => {
    const results: ExperimentReportResultDimension[] = [
      {
        name: "foo",
        srm: 0.5,
        variations: [
          {
            users: 100,
            metrics: {
              met_abc: {
                cr: 0.5,
                users: 100,
                value: 50,
              },
            },
          },
          {
            users: 100,
            metrics: {
              met_abc: {
                cr: 0.6,
                users: 100,
                value: 60,
              },
            },
          },
        ],
      },
    ];

    const queries: Queries = [
      {
        name: "foo",
        query: "select foo",
        status: "succeeded",
      },
    ];

    const now = new Date();

    const initial: Partial<LegacyExperimentSnapshotInterface> = {
      id: "snp_abc123",
      organization: "org_123",
      experiment: "exp_123",
      phase: 1,
      dateCreated: now,
      runStarted: now,
      manual: false,
      queries: queries,
      dimension: "pre:date",
      unknownVariations: ["3"],
      multipleExposures: 5,
      hasCorrectedStats: true,
      results: results,
      hasRawQueries: true,
      queryFilter: "foo = 1",
      segment: "seg_123",
      activationMetric: "met_123",
      skipPartialData: false,
      statsEngine: "bayesian",
    };

    const result: ExperimentSnapshotInterface = {
      id: "snp_abc123",
      organization: "org_123",
      experiment: "exp_123",
      phase: 1,
      dateCreated: now,
      runStarted: now,
      queries: queries,
      dimension: "pre:date",
      unknownVariations: ["3"],
      multipleExposures: 5,
      analyses: [
        {
          dateCreated: now,
          results: results,
          status: "success",
          settings: {
            differenceType: "relative",
            dimensions: ["pre:date"],
            statsEngine: "bayesian",
            pValueCorrection: null,
            regressionAdjusted: false,
            sequentialTesting: false,
            sequentialTestingTuningParameter: 5000,
          },
        },
      ],
      settings: {
        queryFilter: "foo = 1",
        activationMetric: "met_123",
        attributionModel: "firstExposure",
        datasourceId: "",
        dimensions: [
          {
            id: "pre:date",
          },
        ],
        endDate: now,
        experimentId: "",
        exposureQueryId: "",
        goalMetrics: ["met_abc"],
        guardrailMetrics: [],
        manual: false,
        metricSettings: [
          {
            id: "met_abc",
            computedSettings: {
              windowSettings: {
                type: "conversion",
                windowUnit: "hours",
                windowValue: 72,
                delayHours: 0,
              },
              regressionAdjustmentDays: 0,
              regressionAdjustmentEnabled: false,
              regressionAdjustmentAvailable: false,
              regressionAdjustmentReason: "",
            },
          },
          {
            id: "met_123",
            computedSettings: {
              windowSettings: {
                type: "conversion",
                windowUnit: "hours",
                windowValue: 72,
                delayHours: 0,
              },
              regressionAdjustmentDays: 0,
              regressionAdjustmentEnabled: false,
              regressionAdjustmentAvailable: false,
              regressionAdjustmentReason: "",
            },
          },
        ],
        regressionAdjustmentEnabled: false,
        segment: "seg_123",
        skipPartialData: false,
        startDate: now,
        variations: [
          { id: "0", weight: 0 },
          { id: "1", weight: 0 },
        ],
      },
      status: "success",
    };

    expect(
      migrateSnapshot(initial as LegacyExperimentSnapshotInterface)
    ).toEqual(result);
  });

  it("migrates mixpanel snapshots", () => {
    const now = new Date();

    const initial: Partial<LegacyExperimentSnapshotInterface> = {
      id: "snp_abc123",
      organization: "org_123",
      experiment: "exp_123",
      phase: 1,
      dateCreated: now,
      runStarted: now,
      manual: false,
      query: "foo",
      queryLanguage: "javascript",
      dimension: "",
      hasRawQueries: true,
    };

    const result: ExperimentSnapshotInterface = {
      id: "snp_abc123",
      organization: "org_123",
      experiment: "exp_123",
      phase: 1,
      dateCreated: now,
      runStarted: now,
      queries: [],
      dimension: "",
      unknownVariations: [],
      multipleExposures: 0,
      analyses: [],
      settings: {
        queryFilter: "",
        activationMetric: null,
        attributionModel: "firstExposure",
        datasourceId: "",
        dimensions: [],
        endDate: now,
        experimentId: "",
        exposureQueryId: "",
        goalMetrics: [],
        guardrailMetrics: [],
        manual: false,
        metricSettings: [],
        regressionAdjustmentEnabled: false,
        segment: "",
        skipPartialData: false,
        startDate: now,
        variations: [],
      },
      status: "running",
    };

    expect(
      migrateSnapshot(initial as LegacyExperimentSnapshotInterface)
    ).toEqual(result);

    initial.error = "foo";
    result.error = "foo";
    result.status = "error";
    expect(
      migrateSnapshot(initial as LegacyExperimentSnapshotInterface)
    ).toEqual(result);
  });

  it("migrates manual snapshots", () => {
    const now = new Date();

    const results: ExperimentReportResultDimension[] = [
      {
        name: "foo",
        srm: 0.5,
        variations: [
          {
            users: 100,
            metrics: {
              met_abc: {
                cr: 0.5,
                users: 100,
                value: 50,
              },
            },
          },
          {
            users: 100,
            metrics: {
              met_abc: {
                cr: 0.6,
                users: 100,
                value: 60,
              },
            },
          },
        ],
      },
    ];

    const initial: Partial<LegacyExperimentSnapshotInterface> = {
      id: "snp_abc123",
      organization: "org_123",
      experiment: "exp_123",
      phase: 1,
      dateCreated: now,
      manual: true,
      results,
    };

    const result: ExperimentSnapshotInterface = {
      id: "snp_abc123",
      organization: "org_123",
      experiment: "exp_123",
      phase: 1,
      dateCreated: now,
      runStarted: null,
      queries: [],
      dimension: "",
      unknownVariations: [],
      multipleExposures: 0,
      analyses: [
        {
          dateCreated: now,
          results,
          settings: {
            differenceType: "relative",
            dimensions: [],
            statsEngine: "bayesian",
            pValueCorrection: null,
            regressionAdjusted: false,
            sequentialTesting: false,
            sequentialTestingTuningParameter: 5000,
          },
          status: "success",
        },
      ],
      settings: {
        queryFilter: "",
        activationMetric: null,
        attributionModel: "firstExposure",
        datasourceId: "",
        dimensions: [],
        endDate: now,
        experimentId: "",
        exposureQueryId: "",
        goalMetrics: ["met_abc"],
        guardrailMetrics: [],
        manual: true,
        metricSettings: [
          {
            id: "met_abc",
            computedSettings: {
              windowSettings: {
                type: "conversion",
                windowUnit: "hours",
                windowValue: 72,
                delayHours: 0,
              },
              regressionAdjustmentDays: 0,
              regressionAdjustmentEnabled: false,
              regressionAdjustmentAvailable: false,
              regressionAdjustmentReason: "",
            },
          },
        ],
        regressionAdjustmentEnabled: false,
        segment: "",
        skipPartialData: false,
        startDate: now,
        variations: [
          { id: "0", weight: 0 },
          { id: "1", weight: 0 },
        ],
      },
      status: "success",
    };

    expect(
      migrateSnapshot(initial as LegacyExperimentSnapshotInterface)
    ).toEqual(result);
  });
});

describe("saved group migrations", () => {
  const baseSavedGroup: LegacySavedGroupInterface = {
    id: "grp_123",
    organization: "org_123",
    groupName: "test",
    owner: "user_123",
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };

  it("migrates old saved groups without source", () => {
    expect(
      migrateSavedGroup({
        ...baseSavedGroup,
        attributeKey: "foo",
        values: ["a", "b"],
      })
    ).toEqual({
      ...baseSavedGroup,
      attributeKey: "foo",
      values: ["a", "b"],
      type: "list",
    });
  });

  it("migrates saved groups with source=inline", () => {
    expect(
      migrateSavedGroup({
        ...baseSavedGroup,
        attributeKey: "foo",
        values: ["a", "b"],
        source: "inline",
      })
    ).toEqual({
      ...baseSavedGroup,
      attributeKey: "foo",
      values: ["a", "b"],
      type: "list",
    });
  });

  it("migrates saved groups with source=runtime", () => {
    expect(
      migrateSavedGroup({
        ...baseSavedGroup,
        attributeKey: "foo",
        values: [],
        source: "runtime",
      })
    ).toEqual({
      ...baseSavedGroup,
      attributeKey: "foo",
      values: [],
      type: "condition",
      condition: JSON.stringify({ $groups: { $elemMatch: { $eq: "foo" } } }),
    });
  });

  it("does not migrate saved groups that already have type=list", () => {
    expect(
      migrateSavedGroup({
        ...baseSavedGroup,
        attributeKey: "foo",
        values: ["a", "b"],
        source: "inline",
        type: "list",
      })
    ).toEqual({
      ...baseSavedGroup,
      attributeKey: "foo",
      values: ["a", "b"],
      type: "list",
    });
  });

  it("does not migrate saved groups that already have type=condition", () => {
    expect(
      migrateSavedGroup({
        ...baseSavedGroup,
        attributeKey: "foo",
        values: [],
        source: "runtime",
        type: "condition",
        condition: JSON.stringify({ id: { $eq: "123" } }),
      })
    ).toEqual({
      ...baseSavedGroup,
      attributeKey: "foo",
      values: [],
      type: "condition",
      condition: JSON.stringify({ id: { $eq: "123" } }),
    });
  });
});
