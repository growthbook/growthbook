import {
  updateDataSource,
  validateExposureQueriesAndAddMissingIds,
  hasActualChanges,
} from "../../src/models/DataSourceModel";
import { DataSourceInterface } from "../../types/datasource";
import { testQueryValidity } from "../../src/services/datasource";
import { usingFileConfig } from "../../src/init/config";

jest.mock("../../src/services/datasource");
jest.mock("../../src/init/config");

describe("dataSourceModel", () => {
  const datasource: DataSourceInterface = {
    id: "123",
    organization: "test",
    name: "Test Data Source",
    type: "postgres",
    description: "desc",
    params: "params",
    settings: {
      queries: {
        exposure: [
          {
            id: "anonymous_id",
            userIdType: "anonymous_id",
            dimensions: ["device", "browser"],
            name: "Anonymous Visitors",
            description: "",
            query: "SELECT anonymous_id FROM experiment_viewed",
          },
          {
            id: "user_id",
            userIdType: "user_id",
            dimensions: ["device", "browser"],
            name: "Logged in Users",
            description: "",
            query: "SELECT bad query",
            error: "Error: bad query",
          },
        ],
      },
    },
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("hasActualChanges", () => {
    it("should not update if no changes are made", async () => {
      const updates: Partial<DataSourceInterface> = {};
      expect(hasActualChanges(datasource, updates)).toEqual(false);
    });

    it("should not update if what it is trying to update is the same as current datasource", async () => {
      const updates: Partial<DataSourceInterface> = {
        dateUpdated: new Date(),
        name: "Test Data Source",
      };
      expect(hasActualChanges(datasource, updates)).toEqual(false);
    });

    it("should update if changes are made", async () => {
      const updates: Partial<DataSourceInterface> = {
        name: "Updated Data Source",
      };
      expect(hasActualChanges(datasource, updates)).toEqual(true);
    });
  });

  describe("validateExposureQueriesAndAddMissingIds", () => {
    it("should add missing exposure query ids and validate new queries", async () => {
      // @ts-expect-error - not sure why it doesn't realize testQueryValidity is a mock
      testQueryValidity.mockResolvedValue(undefined);

      const updates: Partial<DataSourceInterface> = {
        settings: {
          queries: {
            exposure: [
              // @ts-expect-error - we are testing the case where id is missing
              {
                query: "SELECT new_id FROM experiment_viewed",
              },
            ],
          },
        },
      };
      const new_updates = await validateExposureQueriesAndAddMissingIds(
        datasource,
        updates
      );
      expect(testQueryValidity).toHaveBeenCalledWith(
        datasource,
        "SELECT new_id FROM experiment_viewed"
      );
      expect(new_updates).toEqual({
        settings: {
          queries: {
            exposure: [
              {
                id: expect.any(String),
                query: "SELECT new_id FROM experiment_viewed",
                error: undefined,
              },
            ],
          },
        },
      });
    });

    it("should validate previously errored queries", async () => {
      // @ts-expect-error - not sure why it doesn't realize testQueryValidity is a mock
      testQueryValidity.mockResolvedValue("bad query still bad");
      const updates: Partial<DataSourceInterface> = {
        settings: {
          queries: {
            exposure: [
              {
                id: "user_id",
                userIdType: "user_id",
                dimensions: ["device", "browser"],
                name: "Logged in Users",
                description: "",
                query: "SELECT bad query",
                error: "Error: bad query",
              },
            ],
          },
        },
      };
      const new_updates = await validateExposureQueriesAndAddMissingIds(
        datasource,
        updates
      );
      expect(testQueryValidity).toHaveBeenCalledWith(
        datasource,
        "SELECT bad query"
      );
      const expected = updates;
      if (expected?.settings?.queries?.exposure) {
        expected.settings.queries.exposure[0].error = "bad query still bad";
      }
      expect(new_updates).toEqual(expected);
    });

    it("should validate changed queries", async () => {
      // @ts-expect-error - not sure why it doesn't realize testQueryValidity is a mock
      testQueryValidity.mockResolvedValue(undefined);
      const updates: Partial<DataSourceInterface> = {
        settings: {
          queries: {
            exposure: [
              {
                id: "anonymous_id",
                userIdType: "anonymous_id",
                dimensions: ["device", "browser"],
                name: "Anonymous Visitors",
                description: "",
                query: "SELECT changed_anonymous_id FROM experiment_viewed",
              },
            ],
          },
        },
      };
      const new_updates = await validateExposureQueriesAndAddMissingIds(
        datasource,
        updates
      );
      expect(testQueryValidity).toHaveBeenCalledWith(
        datasource,
        "SELECT changed_anonymous_id FROM experiment_viewed"
      );
      const expected = updates;
      if (expected?.settings?.queries?.exposure) {
        expected.settings.queries.exposure[0].error = undefined;
      }
      expect(new_updates).toEqual(updates);
    });
  });

  describe("updateDataSource", () => {
    it("should throw an error if data sources are managed by config.yml", async () => {
      // @ts-expect-error - not sure why it doesn't realize usingFileConfig is a mock
      usingFileConfig.mockReturnValue(true);
      const updates: Partial<DataSourceInterface> = {
        name: "Updated Data Source",
      };
      await expect(
        updateDataSource(datasource, "test", updates)
      ).rejects.toThrow("Cannot update. Data sources managed by config.yml");
    });
  });
});
