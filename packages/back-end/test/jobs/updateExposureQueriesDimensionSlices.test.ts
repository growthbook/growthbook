import { subDays } from "date-fns";

import {
  getDataSourcesWithExposureQueriesToUpdate,
  updateSingleDatasourceExposureQueriesDimensionSlices,
} from "back-end/src/jobs/updateExposureQueriesDimensionSlices";

import type { DataSourceInterface } from "back-end/types/datasource";
import type { DimensionSlicesInterface } from "back-end/types/dimension";

// Mocks
jest.mock("back-end/src/models/DataSourceModel", () => ({
  _dangerousGetAllDatasourcesWithExposureQueriesWithAutomaticDimensionSlices:
    jest.fn(),
  getDataSourceById: jest.fn(),
  updateDataSource: jest.fn(),
}));

jest.mock("back-end/src/models/DimensionSlicesModel", () => ({
  _dangerousGetAllDimensionSlicesByIds: jest.fn(),
  createDimensionSlices: jest.fn(),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
}));

jest.mock("back-end/src/services/datasource", () => ({
  getIntegrationFromDatasourceId: jest.fn(),
}));

jest.mock("back-end/src/queryRunners/DimensionSlicesQueryRunner", () => ({
  DimensionSlicesQueryRunner: class MockRunner {
    public model: DimensionSlicesInterface;
    constructor(
      _context: unknown,
      model: DimensionSlicesInterface,
      _integration: unknown,
    ) {
      // Simulate results being produced; id may be replaced by the test
      this.model = {
        ...model,
        id: model.id || "dimslice_test_generated",
        results: [
          {
            dimension: "device",
            dimensionSlices: [
              { name: "iOS", percent: 0.5 },
              { name: "Android", percent: 0.5 },
            ],
          },
        ],
      } as DimensionSlicesInterface;
    }
    startAnalysis = jest.fn();
    waitForResults = jest.fn(async () => undefined);
  },
}));

import {
  _dangerousGetAllDatasourcesWithExposureQueriesWithAutomaticDimensionSlices,
  getDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import {
  _dangerousGetAllDimensionSlicesByIds,
  createDimensionSlices,
} from "back-end/src/models/DimensionSlicesModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";

const mockDatasources =
  _dangerousGetAllDatasourcesWithExposureQueriesWithAutomaticDimensionSlices as jest.Mock;
const mockGetDataSourceById = getDataSourceById as jest.Mock;
const mockUpdateDataSource = updateDataSource as jest.Mock;
const mockGetSlicesByIds = _dangerousGetAllDimensionSlicesByIds as jest.Mock;
const mockCreateDimensionSlices = createDimensionSlices as jest.Mock;
const mockGetContext = getContextForAgendaJobByOrgId as jest.Mock;
const mockGetIntegration = getIntegrationFromDatasourceId as jest.Mock;

describe("updateExposureQueriesDimensionSlices job", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getDataSourcesWithExposureQueriesToUpdate", () => {
    it("excludes data sources with no dimensions configured", async () => {
      const dsNoDims: Partial<DataSourceInterface> = {
        id: "ds_no_dims",
        organization: "org",
        settings: {
          queries: {
            exposure: [
              {
                id: "eq1",
                userIdType: "user_id",
                dimensions: [],
                name: "Q1",
                query: "",
                // No dimensionMetadata at all → treated as no automatic slices
              },
            ],
          },
        },
      };

      mockDatasources.mockResolvedValue([dsNoDims]);
      // No slices returned
      mockGetSlicesByIds.mockImplementation(async () => []);

      const results = await getDataSourcesWithExposureQueriesToUpdate();
      expect(results).toEqual([]);
    });

    it("excludes data sources whose dimension slices were updated in the last 7 days", async () => {
      const dsRecent: Partial<DataSourceInterface> = {
        id: "ds_recent",
        organization: "org",
        settings: {
          queries: {
            exposure: [
              {
                id: "eq_recent",
                userIdType: "user_id",
                dimensions: ["device"],
                name: "Q recent",
                query: "",
                dimensionSlicesId: "slice_recent",
                dimensionMetadata: [
                  {
                    dimension: "device",
                    specifiedSlices: [],
                    customSlices: false,
                  },
                ],
              },
            ],
          },
        },
      };

      mockDatasources.mockResolvedValue([dsRecent]);

      const recentSlice: DimensionSlicesInterface = {
        id: "slice_recent",
        organization: "org",
        datasource: dsRecent.id as string,
        exposureQueryId: "eq_recent",
        runStarted: new Date(),
        queries: [],
        results: [],
        error: "",
      };

      // Mimic real filtering by runStarted < cutoff
      mockGetSlicesByIds.mockImplementation(
        async (ids: string[], runStartedLt?: Date) => {
          const all = [recentSlice];
          return all.filter(
            (s) =>
              ids.includes(s.id) &&
              (!runStartedLt || s.runStarted < runStartedLt),
          );
        },
      );

      const results = await getDataSourcesWithExposureQueriesToUpdate();
      expect(results).toEqual([]);
    });

    it("includes only exposure queries with customSlices=false", async () => {
      const dsMixed: Partial<DataSourceInterface> = {
        id: "ds_mixed",
        organization: "org",
        settings: {
          queries: {
            exposure: [
              {
                id: "eq_auto",
                userIdType: "user_id",
                dimensions: ["device"],
                name: "Auto",
                query: "",
                dimensionSlicesId: "slice_old",
                dimensionMetadata: [
                  {
                    dimension: "device",
                    specifiedSlices: [],
                    customSlices: false,
                  },
                ],
              },
              {
                id: "eq_custom",
                userIdType: "user_id",
                dimensions: ["device"],
                name: "Custom",
                query: "",
                dimensionSlicesId: "slice_old_custom",
                dimensionMetadata: [
                  {
                    dimension: "device",
                    specifiedSlices: [],
                    customSlices: true,
                  },
                ],
              },
            ],
          },
        },
      };

      const oldSlice: DimensionSlicesInterface = {
        id: "slice_old",
        organization: "org",
        datasource: dsMixed.id as string,
        exposureQueryId: "eq_auto",
        runStarted: subDays(new Date(), 10),
        queries: [],
        results: [],
        error: "",
      };
      const oldSliceCustom: DimensionSlicesInterface = {
        id: "slice_old_custom",
        organization: "org",
        datasource: dsMixed.id as string,
        exposureQueryId: "eq_custom",
        runStarted: subDays(new Date(), 10),
        queries: [],
        results: [],
        error: "",
      };

      mockDatasources.mockResolvedValue([dsMixed]);
      mockGetSlicesByIds.mockImplementation(
        async (ids: string[], runStartedLt?: Date) => {
          const all = [oldSlice, oldSliceCustom];
          return all.filter(
            (s) =>
              ids.includes(s.id) &&
              (!runStartedLt || s.runStarted < runStartedLt),
          );
        },
      );

      const results = await getDataSourcesWithExposureQueriesToUpdate();
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        dataSourceId: "ds_mixed",
        exposureQueryIds: ["eq_auto"],
      });
    });
  });

  describe("updateSingleDatasourceExposureQueriesDimensionSlices", () => {
    it("updates only the specified exposure query and preserves others", async () => {
      const ds: DataSourceInterface = {
        id: "ds1",
        organization: "org",
        name: "DS",
        type: "postgres",
        description: "",
        params: "",
        settings: {
          queries: {
            exposure: [
              {
                id: "eq_target",
                userIdType: "user_id",
                dimensions: ["device", "browser"],
                name: "Target",
                description: "",
                query: "select * from x",
              },
              {
                id: "eq_other",
                userIdType: "user_id",
                dimensions: ["device"],
                name: "Other",
                description: "",
                query: "select * from y",
                // Existing metadata should remain unchanged
                dimensionSlicesId: "slice_existing",
                dimensionMetadata: [
                  {
                    dimension: "device",
                    specifiedSlices: ["A"],
                    customSlices: true,
                  },
                ],
              },
            ],
          },
        },
        dateCreated: new Date(),
        dateUpdated: new Date(),
      };

      mockGetContext.mockResolvedValue({ org: { id: "org" } });
      mockGetDataSourceById.mockResolvedValue(ds);
      mockGetIntegration.mockResolvedValue({});
      mockCreateDimensionSlices.mockResolvedValue({
        id: "dimslice_created",
        organization: "org",
        datasource: ds.id,
        exposureQueryId: "eq_target",
        runStarted: new Date(),
        queries: [],
        results: [],
        error: "",
      } satisfies DimensionSlicesInterface);

      const job = {
        attrs: {
          data: {
            organizationId: "org",
            dataSourceId: ds.id,
            exposureQueryIds: ["eq_target"],
          },
        },
      };

      // @ts-expect-error Passing just the job data for the test
      await updateSingleDatasourceExposureQueriesDimensionSlices(job);

      expect(mockUpdateDataSource).toHaveBeenCalledTimes(1);
      const [_ctx, _origDs, updated] = mockUpdateDataSource.mock.calls[0];

      const updatedExposure = updated.settings.queries.exposure;
      // Should still have both exposure queries
      expect(updatedExposure).toHaveLength(2);

      const target = updatedExposure.find((q) => q.id === "eq_target");
      const other = updatedExposure.find((q) => q.id === "eq_other");

      // Target got updated with a new dimensionSlicesId and metadata produced by the runner
      expect(target.dimensionSlicesId).toBeDefined();
      expect(target.dimensionMetadata).toEqual([
        {
          dimension: "device",
          specifiedSlices: ["iOS", "Android"],
          customSlices: false,
        },
        {
          dimension: "browser",
          specifiedSlices: [],
          customSlices: false,
        },
      ]);

      // Other remains unchanged
      expect(other).toMatchObject({
        id: "eq_other",
        dimensionSlicesId: "slice_existing",
        dimensionMetadata: [
          { dimension: "device", specifiedSlices: ["A"], customSlices: true },
        ],
      });
    });
  });
});
