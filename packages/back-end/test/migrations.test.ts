/* eslint-disable @typescript-eslint/no-explicit-any */

import cloneDeep from "lodash/cloneDeep";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import omit from "lodash/omit";
import { LegacyMetricInterface } from "back-end/types/metric";
import {
  migrateExperimentReport,
  migrateSavedGroup,
  migrateSnapshot,
  upgradeDatasourceObject,
  upgradeExperimentDoc,
  upgradeFeatureInterface,
  upgradeFeatureRule,
  upgradeMetricDoc,
  upgradeOrganizationDoc,
} from "back-end/src/util/migrations";
import {
  DataSourceInterface,
  DataSourceSettings,
} from "back-end/types/datasource";
import { FactMetricModel } from "back-end/src/models/FactMetricModel";
import { encryptParams } from "back-end/src/services/datasource";
import { MixpanelConnectionParams } from "back-end/types/integrations/mixpanel";
import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import {
  LegacyColumnRef,
  LegacyFactMetricInterface,
} from "back-end/types/fact-table";
import {
  ExperimentRule,
  FeatureInterface,
  FeatureRule,
  LegacyFeatureInterface,
} from "back-end/types/feature";
import { OrganizationInterface } from "back-end/types/organization";
import {
  ExperimentSnapshotInterface,
  LegacyExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import {
  ExperimentReportResultDimension,
  LegacyReportInterface,
} from "back-end/types/report";
import { Queries } from "back-end/types/query";
import { ExperimentPhase } from "back-end/types/experiment";
import { LegacySavedGroupInterface } from "back-end/types/saved-group";

describe("Fact Metric Migration", () => {
  it("upgrades delay hours", () => {
    const baseFactMetric: LegacyFactMetricInterface = {
      id: "",
      organization: "",
      owner: "",
      datasource: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      name: "",
      description: "",
      tags: [],
      projects: [],
      inverse: false,

      metricType: "proportion",
      numerator: {
        factTableId: "",
        column: "",
        rowFilters: [],
      },
      denominator: null,

      windowSettings: {
        type: "",
        delayUnit: "hours",
        delayValue: 0,
        windowUnit: "hours",
        windowValue: 0,
      },
      cappingSettings: {
        type: "",
        value: 0,
      },
      priorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: DEFAULT_PROPER_PRIOR_STDDEV,
      },

      maxPercentChange: 0.05,
      minPercentChange: 500,
      minSampleSize: 150,
      winRisk: 0.1,
      loseRisk: 3,

      regressionAdjustmentOverride: false,
      regressionAdjustmentEnabled: true,
      regressionAdjustmentDays: 14,

      quantileSettings: null,
    };

    const delayHours: LegacyFactMetricInterface = {
      ...baseFactMetric,
      windowSettings: {
        type: "",
        delayHours: 14,
        windowUnit: "hours",
        windowValue: 0,
      },
    };
    expect(FactMetricModel.upgradeFactMetricDoc(delayHours)).toEqual({
      ...delayHours,
      windowSettings: {
        type: "",
        delayUnit: "hours",
        delayValue: 14,
        windowUnit: "hours",
        windowValue: 0,
      },
    });
  });

  describe("ColumnRef migration", () => {
    it("upgrades filters", () => {
      expect(
        FactMetricModel.migrateColumnRef({
          factTableId: "ft_123",
          column: "event_name",
          filters: ["filt_123"],
        }),
      ).toEqual({
        factTableId: "ft_123",
        column: "event_name",
        rowFilters: [
          {
            operator: "saved_filter",
            values: ["filt_123"],
          },
        ],
      });
    });
    it("upgrades multiple filters", () => {
      expect(
        FactMetricModel.migrateColumnRef({
          factTableId: "ft_123",
          column: "event_name",
          filters: ["filt_123", "filt_456"],
        }),
      ).toEqual({
        factTableId: "ft_123",
        column: "event_name",
        rowFilters: [
          {
            operator: "saved_filter",
            values: ["filt_123"],
          },
          {
            operator: "saved_filter",
            values: ["filt_456"],
          },
        ],
      });
    });
    it("ignores empty filters array", () => {
      expect(
        FactMetricModel.migrateColumnRef({
          factTableId: "ft_123",
          column: "event_name",
          filters: [],
        }),
      ).toEqual({
        factTableId: "ft_123",
        column: "event_name",
        rowFilters: [],
      });
    });

    it("ignores already migrated rowFilters", () => {
      expect(
        FactMetricModel.migrateColumnRef({
          factTableId: "ft_123",
          column: "event_name",
          filters: ["filt_456"],
          rowFilters: [
            {
              operator: "saved_filter",
              values: ["filt_123"],
            },
          ],
        }),
      ).toEqual({
        factTableId: "ft_123",
        column: "event_name",
        rowFilters: [
          {
            operator: "saved_filter",
            values: ["filt_123"],
          },
        ],
      });
    });

    it("migrates inline filters", () => {
      expect(
        FactMetricModel.migrateColumnRef({
          factTableId: "ft_123",
          column: "event_name",
          inlineFilters: {
            event_type: ["value1", "value2"],
          },
        }),
      ).toEqual({
        factTableId: "ft_123",
        column: "event_name",
        rowFilters: [
          {
            column: "event_type",
            operator: "in",
            values: ["value1", "value2"],
          },
        ],
      });
    });
    it("migrates inline filters with a single value to =", () => {
      expect(
        FactMetricModel.migrateColumnRef({
          factTableId: "ft_123",
          column: "event_name",
          inlineFilters: {
            event_type: ["value1"],
          },
        }),
      ).toEqual({
        factTableId: "ft_123",
        column: "event_name",
        rowFilters: [
          {
            column: "event_type",
            operator: "=",
            values: ["value1"],
          },
        ],
      });
    });
    it("migrates multiple inline filters", () => {
      expect(
        FactMetricModel.migrateColumnRef({
          factTableId: "ft_123",
          column: "event_name",
          inlineFilters: {
            event_type: ["value1", "value2"],
            user_id: ["user1"],
          },
        }),
      ).toEqual({
        factTableId: "ft_123",
        column: "event_name",
        rowFilters: [
          {
            column: "event_type",
            operator: "in",
            values: ["value1", "value2"],
          },
          {
            column: "user_id",
            operator: "=",
            values: ["user1"],
          },
        ],
      });
    });
    it("ignores empty inline filters", () => {
      expect(
        FactMetricModel.migrateColumnRef({
          factTableId: "ft_123",
          column: "event_name",
          inlineFilters: {},
        }),
      ).toEqual({
        factTableId: "ft_123",
        column: "event_name",
        rowFilters: [],
      });
    });
    it("ignores empty arrays in inline filters", () => {
      expect(
        FactMetricModel.migrateColumnRef({
          factTableId: "ft_123",
          column: "event_name",
          inlineFilters: {
            event_type: [],
          },
        }),
      ).toEqual({
        factTableId: "ft_123",
        column: "event_name",
        rowFilters: [],
      });
    });
    it("ignores empty strings in arrays in inline filters", () => {
      expect(
        FactMetricModel.migrateColumnRef({
          factTableId: "ft_123",
          column: "event_name",
          inlineFilters: {
            event_type: [""],
            other: ["value1", ""],
          },
        }),
      ).toEqual({
        factTableId: "ft_123",
        column: "event_name",
        rowFilters: [
          {
            column: "other",
            operator: "=",
            values: ["value1"],
          },
        ],
      });
    });
    it("migrates both filters and inlineFilters", () => {
      expect(
        FactMetricModel.migrateColumnRef({
          factTableId: "ft_123",
          column: "event_name",
          filters: ["filt_456"],
          inlineFilters: {
            event_type: ["value1", "value2"],
          },
        }),
      ).toEqual({
        factTableId: "ft_123",
        column: "event_name",
        rowFilters: [
          {
            operator: "saved_filter",
            values: ["filt_456"],
          },
          {
            column: "event_type",
            operator: "in",
            values: ["value1", "value2"],
          },
        ],
      });
    });
    it("ignores filters and inlineFilters when rowFilters is defined", () => {
      expect(
        FactMetricModel.migrateColumnRef({
          factTableId: "ft_123",
          column: "event_name",
          rowFilters: [],
          filters: ["filt_456"],
          inlineFilters: {
            event_type: ["value1", "value2"],
          },
        }),
      ).toEqual({
        factTableId: "ft_123",
        column: "event_name",
        rowFilters: [],
      });
    });
    it("Can unmigrate filters for API responses", () => {
      const original: LegacyColumnRef = {
        factTableId: "ft_123",
        column: "event_name",
        filters: ["filt_123", "filt_456"],
        inlineFilters: {
          event_type: ["value1", "value2"],
          single_val: ["true"],
        },
      };
      const migrated = FactMetricModel.migrateColumnRef(original);
      expect(migrated).toEqual({
        factTableId: "ft_123",
        column: "event_name",
        rowFilters: [
          {
            operator: "saved_filter",
            values: ["filt_123"],
          },
          {
            operator: "saved_filter",
            values: ["filt_456"],
          },
          {
            column: "event_type",
            operator: "in",
            values: ["value1", "value2"],
          },
          {
            column: "single_val",
            operator: "=",
            values: ["true"],
          },
        ],
      });

      const apiVersion = FactMetricModel.addLegacyFiltersToColumnRef(migrated);
      expect(apiVersion).toEqual({
        ...original,
        rowFilters: migrated.rowFilters,
      });
    });
  });
});

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
      priorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: DEFAULT_PROPER_PRIOR_STDDEV,
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
        delayValue: -0.5,
        delayUnit: "hours",
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
        delayUnit: "hours",
        delayValue: -0.5,
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
        delayUnit: "hours",
        delayValue: 5,
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
        delayUnit: "hours",
        delayValue: 5,
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
        delayUnit: "hours",
        delayValue: 3,
      },
    });
    const delayHours: LegacyMetricInterface = {
      ...baseMetric,
      windowSettings: {
        type: "lookback",
        windowUnit: "days",
        windowValue: 33,
        delayHours: 3,
      },
    };
    expect(upgradeMetricDoc(delayHours)).toEqual({
      ...baseMetric,
      windowSettings: {
        type: "lookback",
        windowUnit: "days",
        windowValue: 33,
        delayUnit: "hours",
        delayValue: 3,
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
        delayUnit: "hours",
        delayValue: 0,
      },
      priorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: DEFAULT_PROPER_PRIOR_STDDEV,
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
        delayUnit: "hours",
        delayValue: 0,
      },
      priorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: DEFAULT_PROPER_PRIOR_STDDEV,
      },
      userIdTypes: ["anonymous_id", "user_id"],
    };

    expect(
      upgradeMetricDoc({
        ...baseMetric,
        capping: "percentile",
        capValue: 0.99,
        cap: 35,
      }),
    ).toEqual({
      ...baseMetric,
      cappingSettings: {
        type: "percentile",
        value: 0.99,
      },
    });

    expect(
      upgradeMetricDoc({ ...baseMetric, capping: "", capValue: 0.99, cap: 35 }),
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
      }),
    ).toEqual({
      ...baseMetric,
      cappingSettings: {
        type: "percentile",
        value: 0.95,
      },
    });
  });

  it("updates old metric objects - adds prior settings", () => {
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
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 72,
        delayUnit: "hours",
        delayValue: 0,
      },
      userIdTypes: ["anonymous_id", "user_id"],
    };

    expect(upgradeMetricDoc(baseMetric)).toEqual({
      ...baseMetric,
      priorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: DEFAULT_PROPER_PRIOR_STDDEV,
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
        delayUnit: "hours",
        delayValue: 0,
      },
      cappingSettings: {
        type: "",
        value: 0,
      },
      priorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: DEFAULT_PROPER_PRIOR_STDDEV,
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
        delayUnit: "hours",
        delayValue: 0,
      },
      cappingSettings: {
        type: "",
        value: 0,
      },
      priorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: DEFAULT_PROPER_PRIOR_STDDEV,
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
  it("adds settings when missing completely", () => {
    const datasource: DataSourceInterface = {
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
      type: "mixpanel",
    } as DataSourceInterface;

    expect(upgradeDatasourceObject({ ...datasource }).settings).toEqual({
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
  });
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
      }).settings,
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
      }).settings,
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

  it("migrates pipelineSettings: add mode if not existing", () => {
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
      settings: {
        pipelineSettings: {
          allowWriting: true,
        } as any,
      },
      type: "mixpanel",
    } as DataSourceInterface;

    const upgraded = upgradeDatasourceObject(cloneDeep(baseDatasource));
    expect(upgraded.settings?.pipelineSettings).toBeDefined();
    expect(upgraded.settings?.pipelineSettings?.mode).toBe("ephemeral");
    expect(upgraded.settings?.pipelineSettings?.allowWriting).toBe(true);
  });

  it("migrates pipelineSettings: does not change mode if it exists", () => {
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
      settings: {
        pipelineSettings: {
          allowWriting: false,
          mode: "incremental",
        } as any,
      },
      type: "mixpanel",
    } as DataSourceInterface;

    const upgraded = upgradeDatasourceObject(cloneDeep(baseDatasource));
    expect(upgraded.settings?.pipelineSettings).toBeDefined();
    expect(upgraded.settings?.pipelineSettings?.mode).toBe("incremental");
    expect(upgraded.settings?.pipelineSettings?.allowWriting).toBe(false);
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
      }),
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
      }),
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
    uid: "1234",
  };

  const upgraded = {
    trackingKey: "test",
    hashAttribute: "",
    hashVersion: 2,
    releasedVariationId: "",
    attributionModel: "experimentDuration",
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
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
    sequentialTestingTuningParameter:
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
    uid: "1234",
    shareLevel: "organization",
    decisionFrameworkSettings: {},
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
      }),
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
      }),
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
      }),
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
      }),
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
      }),
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
      }),
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
  it("Updates metric field names", () => {
    expect(
      upgradeExperimentDoc({
        ...exp,
        metrics: ["met_abc"],
        guardrails: ["met_def"],
      }),
    ).toEqual({
      ...upgraded,
      goalMetrics: ["met_abc"],
      guardrailMetrics: ["met_def"],
      // Keeps old metric fields around, but they're not used
      metrics: ["met_abc"],
      guardrails: ["met_def"],
    });
  });

  it("Does not override new metrics", () => {
    expect(
      upgradeExperimentDoc({
        ...exp,
        goalMetrics: ["met_123"],
        secondaryMetrics: ["met_456"],
        guardrailMetrics: ["met_789"],
        metrics: ["met_abc"],
        guardrails: ["met_def"],
      }),
    ).toEqual({
      ...upgraded,
      goalMetrics: ["met_123"],
      secondaryMetrics: ["met_456"],
      guardrailMetrics: ["met_789"],
      // Keeps old metric fields around, but they're not used
      metrics: ["met_abc"],
      guardrails: ["met_def"],
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
      }),
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

  it("migrate approval flow settings", () => {
    const testOrg: OrganizationInterface = {
      id: "org_sktwi1id9l7z9xkjb",
      name: "Test Org",
      ownerEmail: "test@test.com",
      url: "https://test.com",
      dateCreated: new Date(),
      invites: [],
      members: [],
      settings: {
        requireReviews: true,
      },
    };
    const org = upgradeOrganizationDoc(testOrg);
    expect(org).toEqual({
      ...org,
      settings: {
        ...org.settings,
        requireReviews: [
          {
            environments: [],
            projects: [],
            requireReviewOn: true,
            resetReviewOnChange: false,
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
            numGoalMetrics: 1,
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
        secondaryMetrics: [],
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
                delayUnit: "hours",
                delayValue: 0,
              },
              regressionAdjustmentDays: 0,
              regressionAdjustmentEnabled: false,
              regressionAdjustmentAvailable: false,
              regressionAdjustmentReason: "",
              properPrior: false,
              properPriorMean: 0,
              properPriorStdDev: DEFAULT_PROPER_PRIOR_STDDEV,
            },
          },
          {
            id: "met_123",
            computedSettings: {
              windowSettings: {
                type: "conversion",
                windowUnit: "hours",
                windowValue: 72,
                delayUnit: "hours",
                delayValue: 0,
              },
              regressionAdjustmentDays: 0,
              regressionAdjustmentEnabled: false,
              regressionAdjustmentAvailable: false,
              regressionAdjustmentReason: "",
              properPrior: false,
              properPriorMean: 0,
              properPriorStdDev: DEFAULT_PROPER_PRIOR_STDDEV,
            },
          },
        ],
        defaultMetricPriorSettings: {
          override: false,
          proper: false,
          mean: 0,
          stddev: DEFAULT_PROPER_PRIOR_STDDEV,
        },
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
      migrateSnapshot(initial as LegacyExperimentSnapshotInterface),
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
        secondaryMetrics: [],
        guardrailMetrics: [],
        manual: false,
        metricSettings: [],
        regressionAdjustmentEnabled: false,
        segment: "",
        skipPartialData: false,
        startDate: now,
        variations: [],
        defaultMetricPriorSettings: {
          override: false,
          proper: false,
          mean: 0,
          stddev: DEFAULT_PROPER_PRIOR_STDDEV,
        },
      },
      status: "running",
    };

    expect(
      migrateSnapshot(initial as LegacyExperimentSnapshotInterface),
    ).toEqual(result);

    initial.error = "foo";
    result.error = "foo";
    result.status = "error";
    expect(
      migrateSnapshot(initial as LegacyExperimentSnapshotInterface),
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
            numGoalMetrics: 1,
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
        secondaryMetrics: [],
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
                delayUnit: "hours",
                delayValue: 0,
              },
              regressionAdjustmentDays: 0,
              regressionAdjustmentEnabled: false,
              regressionAdjustmentAvailable: false,
              regressionAdjustmentReason: "",
              properPrior: false,
              properPriorMean: 0,
              properPriorStdDev: DEFAULT_PROPER_PRIOR_STDDEV,
            },
          },
        ],
        defaultMetricPriorSettings: {
          override: false,
          proper: false,
          mean: 0,
          stddev: DEFAULT_PROPER_PRIOR_STDDEV,
        },
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
      migrateSnapshot(initial as LegacyExperimentSnapshotInterface),
    ).toEqual(result);
  });
});

describe("Report Migration", () => {
  const baseLegacyReport: LegacyReportInterface = {
    type: "experiment",
    id: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: "",
    title: "",
    description: "",
    runStarted: null,
    queries: [],
    args: {
      trackingKey: "",
      datasource: "",
      exposureQueryId: "",
      startDate: new Date(),
      variations: [],
      metrics: [],
    },
  };

  it("migrates attribution model", () => {
    const report = {
      ...baseLegacyReport,
      args: {
        ...baseLegacyReport.args,
        attributionModel: "allExposures",
      },
    };

    expect(migrateExperimentReport(report)).toEqual({
      ...report,
      args: {
        ...omit(report.args, "metrics"),
        attributionModel: "experimentDuration",
        goalMetrics: [],
        secondaryMetrics: [],
        guardrailMetrics: [],
        decisionFrameworkSettings: {},
      },
    });
  });

  it("migrates metrics and guardrails", () => {
    const report = {
      ...baseLegacyReport,
      args: {
        ...baseLegacyReport.args,
        metrics: ["met_123"],
        guardrails: ["met_456"],
      },
    };

    expect(migrateExperimentReport(report)).toEqual({
      ...report,
      args: {
        ...omit(report.args, "metrics", "guardrails"),
        goalMetrics: ["met_123"],
        guardrailMetrics: ["met_456"],
        secondaryMetrics: [],
        decisionFrameworkSettings: {},
      },
    });
  });

  it("does not migrate metrics and guardrails if new fields present", () => {
    const report = {
      ...baseLegacyReport,
      args: {
        ...baseLegacyReport.args,
        metrics: ["met_123"],
        guardrails: ["met_456"],
        goalMetrics: ["met_abc"],
        secondaryMetrics: ["met_def"],
        guardrailMetrics: [],
        decisionFrameworkSettings: {},
      },
    };

    expect(migrateExperimentReport(report)).toEqual({
      ...report,
      args: {
        ...omit(report.args, "metrics", "guardrails"),
        goalMetrics: ["met_abc"],
        secondaryMetrics: ["met_def"],
        guardrailMetrics: [],
        decisionFrameworkSettings: {},
      },
    });
  });

  it("migrates metricRegressionAdjustmentStatuses", () => {
    const report: LegacyReportInterface = {
      ...baseLegacyReport,
      args: {
        ...baseLegacyReport.args,
        metricRegressionAdjustmentStatuses: [
          {
            metric: "met_123",
            regressionAdjustmentEnabled: true,
            regressionAdjustmentAvailable: true,
            regressionAdjustmentDays: 14,
            reason: "foo",
          },
        ],
      },
    };

    expect(migrateExperimentReport(report)).toEqual({
      ...report,
      args: {
        ...omit(report.args, "metrics", "metricRegressionAdjustmentStatuses"),
        settingsForSnapshotMetrics: [
          {
            metric: "met_123",
            regressionAdjustmentEnabled: true,
            regressionAdjustmentAvailable: true,
            regressionAdjustmentDays: 14,
            regressionAdjustmentReason: "foo",
            properPrior: false,
            properPriorMean: 0,
            properPriorStdDev: DEFAULT_PROPER_PRIOR_STDDEV,
          },
        ],
        goalMetrics: [],
        secondaryMetrics: [],
        guardrailMetrics: [],
        decisionFrameworkSettings: {},
      },
    });
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
      }),
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
      }),
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
      }),
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
      }),
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
      }),
    ).toEqual({
      ...baseSavedGroup,
      attributeKey: "foo",
      values: [],
      type: "condition",
      condition: JSON.stringify({ id: { $eq: "123" } }),
    });
  });
});
