import md5 from "md5";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type { ExposureQuery } from "shared/types/datasource";
import type { SegmentInterface } from "shared/types/segment";
import type { FactTableInterface } from "shared/types/fact-table";
import {
  experimentSettingsHashMatchesForIncrementalRefresh,
  getExperimentSettingsHashForIncrementalRefresh,
} from "back-end/src/enterprise/services/data-pipeline";

const baseSnapshotSettings: ExperimentSnapshotSettings = {
  manual: false,
  dimensions: [],
  metricSettings: [],
  goalMetrics: [],
  secondaryMetrics: [],
  guardrailMetrics: [],
  activationMetric: null,
  defaultMetricPriorSettings: {
    override: false,
    proper: false,
    mean: 0,
    stddev: 0,
  },
  regressionAdjustmentEnabled: false,
  attributionModel: "firstExposure",
  experimentId: "exp_1",
  queryFilter: "",
  segment: "",
  skipPartialData: false,
  datasourceId: "ds_1",
  exposureQueryId: "exposure",
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-01-31"),
  variations: [],
};

const baseExposureQuery: ExposureQuery = {
  id: "exposure",
  name: "Logged-in Users",
  query: "SELECT user_id, timestamp, experiment_id, variation_id FROM events",
  userIdType: "user_id",
  dimensions: [],
};

const sqlSegment: SegmentInterface = {
  id: "seg_1",
  organization: "org_1",
  owner: "",
  datasource: "ds_1",
  userIdType: "user_id",
  name: "US Users",
  type: "SQL",
  sql: "SELECT user_id, date FROM users WHERE country = 'US'",
  dateCreated: new Date("2024-01-01"),
  dateUpdated: new Date("2024-01-01"),
};

const factTable = {
  id: "ft_1",
  sql: "SELECT user_id, timestamp, country FROM signups",
  eventName: "",
  filters: [
    {
      id: "flt_1",
      name: "US only",
      description: "",
      value: "country = 'US'",
      dateCreated: new Date("2024-01-01"),
      dateUpdated: new Date("2024-01-01"),
    },
  ],
} as unknown as FactTableInterface;

const factSegment: SegmentInterface = {
  ...sqlSegment,
  id: "seg_2",
  type: "FACT",
  sql: "",
  factTableId: "ft_1",
  filters: ["flt_1"],
};

// The hash exactly as it was computed before versioning was introduced —
// kept verbatim so these tests fail if the legacy compatibility path drifts.
function legacyHash(snapshotSettings: ExperimentSnapshotSettings): string {
  return md5(
    JSON.stringify({
      activationMetric: snapshotSettings.activationMetric,
      attributionModel: snapshotSettings.attributionModel,
      queryFilter: snapshotSettings.queryFilter,
      segment: snapshotSettings.segment,
      skipPartialData: snapshotSettings.skipPartialData,
      datasourceId: snapshotSettings.datasourceId,
      exposureQueryId: snapshotSettings.exposureQueryId,
      startDate: snapshotSettings.startDate,
      regressionAdjustmentEnabled: snapshotSettings.regressionAdjustmentEnabled,
      experimentId: snapshotSettings.experimentId,
    }),
  );
}

const currentHashInputs = {
  snapshotSettings: baseSnapshotSettings,
  exposureQuery: baseExposureQuery,
  segment: null,
  factTableMap: new Map(),
};

describe("getExperimentSettingsHashForIncrementalRefresh", () => {
  it("is stable for identical inputs", () => {
    expect(
      getExperimentSettingsHashForIncrementalRefresh(currentHashInputs),
    ).toEqual(
      getExperimentSettingsHashForIncrementalRefresh(currentHashInputs),
    );
  });

  it("is version-prefixed so older stored hashes are distinguishable", () => {
    expect(
      getExperimentSettingsHashForIncrementalRefresh(currentHashInputs),
    ).toMatch(/^v2:/);
  });

  it("ignores endDate, which moves forward on every incremental update", () => {
    const movedEndDate = getExperimentSettingsHashForIncrementalRefresh({
      ...currentHashInputs,
      snapshotSettings: {
        ...baseSnapshotSettings,
        endDate: new Date("2024-06-30"),
      },
    });
    expect(movedEndDate).toEqual(
      getExperimentSettingsHashForIncrementalRefresh(currentHashInputs),
    );
  });

  it("changes when the exposure query SQL changes", () => {
    const editedSql = getExperimentSettingsHashForIncrementalRefresh({
      ...currentHashInputs,
      exposureQuery: {
        ...baseExposureQuery,
        query: "SELECT user_id, timestamp, exp_id, var_id FROM events_v2",
      },
    });
    expect(editedSql).not.toEqual(
      getExperimentSettingsHashForIncrementalRefresh(currentHashInputs),
    );
  });

  it("changes when the exposure query userIdType changes", () => {
    const editedIdType = getExperimentSettingsHashForIncrementalRefresh({
      ...currentHashInputs,
      exposureQuery: { ...baseExposureQuery, userIdType: "anonymous_id" },
    });
    expect(editedIdType).not.toEqual(
      getExperimentSettingsHashForIncrementalRefresh(currentHashInputs),
    );
  });

  it("changes when a SQL segment's SQL changes", () => {
    const withSegment = {
      ...currentHashInputs,
      snapshotSettings: { ...baseSnapshotSettings, segment: "seg_1" },
      segment: sqlSegment,
    };
    const editedSegment = {
      ...withSegment,
      segment: {
        ...sqlSegment,
        sql: "SELECT user_id, date FROM users WHERE country = 'CA'",
      },
    };
    expect(
      getExperimentSettingsHashForIncrementalRefresh(editedSegment),
    ).not.toEqual(getExperimentSettingsHashForIncrementalRefresh(withSegment));
  });

  it("changes when a FACT segment's fact table filter value changes", () => {
    const factTableMap = new Map([["ft_1", factTable]]);
    const withFactSegment = {
      ...currentHashInputs,
      snapshotSettings: { ...baseSnapshotSettings, segment: "seg_2" },
      segment: factSegment,
      factTableMap,
    };
    const editedFilter = {
      ...withFactSegment,
      factTableMap: new Map([
        [
          "ft_1",
          {
            ...factTable,
            filters: [{ ...factTable.filters[0], value: "country = 'CA'" }],
          } as FactTableInterface,
        ],
      ]),
    };
    expect(
      getExperimentSettingsHashForIncrementalRefresh(editedFilter),
    ).not.toEqual(
      getExperimentSettingsHashForIncrementalRefresh(withFactSegment),
    );
  });
});

describe("experimentSettingsHashMatchesForIncrementalRefresh", () => {
  it("matches a current-version stored hash for unchanged inputs", () => {
    const storedHash =
      getExperimentSettingsHashForIncrementalRefresh(currentHashInputs);
    expect(
      experimentSettingsHashMatchesForIncrementalRefresh({
        storedHash,
        ...currentHashInputs,
      }),
    ).toBe(true);
  });

  it("rejects a current-version stored hash when the exposure SQL changed", () => {
    const storedHash =
      getExperimentSettingsHashForIncrementalRefresh(currentHashInputs);
    expect(
      experimentSettingsHashMatchesForIncrementalRefresh({
        storedHash,
        ...currentHashInputs,
        exposureQuery: { ...baseExposureQuery, query: "SELECT 1" },
      }),
    ).toBe(false);
  });

  it("still matches a legacy (unversioned) stored hash when settings are unchanged", () => {
    // A stored hash written by an older build must not read as "outdated"
    // just because this build hashes more inputs — that would silently drop
    // every existing pipeline out of incremental refresh on deploy.
    expect(
      experimentSettingsHashMatchesForIncrementalRefresh({
        storedHash: legacyHash(baseSnapshotSettings),
        ...currentHashInputs,
      }),
    ).toBe(true);
  });

  it("rejects a legacy stored hash when a legacy-hashed setting changed", () => {
    expect(
      experimentSettingsHashMatchesForIncrementalRefresh({
        storedHash: legacyHash(baseSnapshotSettings),
        ...currentHashInputs,
        snapshotSettings: {
          ...baseSnapshotSettings,
          queryFilter: "device = 'mobile'",
        },
      }),
    ).toBe(false);
  });
});
