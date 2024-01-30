import { FULL_ACCESS_PERMISSIONS } from "shared/permissions";
import {
  updateDataSource,
  validateExposureQueriesAndAddMissingIds,
  hasActualChanges,
} from "../../src/models/DataSourceModel";
import {
  DataSourceInterface,
  DataSourceSettings,
} from "../../types/datasource";
import { testQueryValidity } from "../../src/services/datasource";
import { usingFileConfig } from "../../src/init/config";

jest.mock("../../src/services/datasource");
jest.mock("../../src/init/config");

const mockedTestQueryValidity: jest.MockedFunction<
  typeof testQueryValidity
> = testQueryValidity as jest.MockedFunction<typeof testQueryValidity>;
const mockedUsingFileConfig: jest.MockedFunction<
  typeof usingFileConfig
> = usingFileConfig as jest.MockedFunction<typeof usingFileConfig>;

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
      mockedTestQueryValidity.mockResolvedValue(undefined);

      const updates: Partial<DataSourceSettings> = {
        queries: {
          exposure: [
            // @ts-expect-error - we are testing the case where id is missing
            {
              query: "SELECT new_id FROM experiment_viewed",
            },
          ],
        },
      };
      const new_updates = await validateExposureQueriesAndAddMissingIds(
        datasource,
        updates
      );
      console.log("new updates", new_updates);
      expect(mockedTestQueryValidity).toHaveBeenCalled();
      expect(new_updates).toEqual({
        queries: {
          exposure: [
            {
              error: undefined,
              id: expect.any(String),
              query: "SELECT new_id FROM experiment_viewed",
            },
          ],
        },
      });
    });

    it("should validate previously errored queries", async () => {
      mockedTestQueryValidity.mockResolvedValue("bad query still bad");
      const updates: Partial<DataSourceSettings> = {
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
      };
      const new_updates = await validateExposureQueriesAndAddMissingIds(
        datasource,
        updates
      );
      expect(testQueryValidity).toHaveBeenCalled();
      const expected = updates;
      if (expected?.queries?.exposure) {
        expected.queries.exposure[0].error = "bad query still bad";
      }
      expect(new_updates).toEqual(expected);
    });

    it("should validate changed queries", async () => {
      mockedTestQueryValidity.mockResolvedValue("bad query");
      const updates: Partial<DataSourceSettings> = {
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
      };
      const new_updates = await validateExposureQueriesAndAddMissingIds(
        datasource,
        updates
      );
      expect(testQueryValidity).toHaveBeenCalled();
      const expected = updates;
      if (expected?.queries?.exposure) {
        expected.queries.exposure[0].error = "bad query";
      }
      expect(new_updates).toEqual(updates);
    });

    it("should validate changed dimensions", async () => {
      mockedTestQueryValidity.mockResolvedValue("bad query");
      const updates: Partial<DataSourceSettings> = {
        queries: {
          exposure: [
            {
              id: "anonymous_id",
              userIdType: "anonymous_id",
              dimensions: ["device"],
              name: "Anonymous Visitors",
              description: "",
              query: "SELECT anonymous_id FROM experiment_viewed",
            },
          ],
        },
      };
      const new_updates = await validateExposureQueriesAndAddMissingIds(
        datasource,
        updates
      );
      expect(testQueryValidity).toHaveBeenCalled();
      const expected = updates;
      if (expected?.queries?.exposure) {
        expected.queries.exposure[0].error = "bad query";
      }
      expect(new_updates).toEqual(updates);
    });

    it("should validate changed hasNameColumns", async () => {
      mockedTestQueryValidity.mockResolvedValue("bad query");
      const updates: Partial<DataSourceSettings> = {
        queries: {
          exposure: [
            {
              id: "anonymous_id",
              userIdType: "anonymous_id",
              dimensions: ["device"],
              name: "Anonymous Visitors",
              hasNameCol: true,
              description: "",
              query: "SELECT anonymous_id FROM experiment_viewed",
            },
          ],
        },
      };
      const new_updates = await validateExposureQueriesAndAddMissingIds(
        datasource,
        updates
      );
      expect(testQueryValidity).toHaveBeenCalled();
      const expected = updates;
      if (expected?.queries?.exposure) {
        expected.queries.exposure[0].error = "bad query";
      }
      expect(new_updates).toEqual(updates);
    });

    it("should not revalidate unchanged queries", async () => {
      mockedTestQueryValidity.mockResolvedValue("bad query");
      const updates: Partial<DataSourceSettings> = {
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
          ],
        },
      };
      const new_updates = await validateExposureQueriesAndAddMissingIds(
        datasource,
        updates
      );
      expect(testQueryValidity).not.toHaveBeenCalled();
      const expected = updates;
      if (expected?.queries?.exposure) {
        expected.queries.exposure[0].error = undefined;
      }
      expect(new_updates).toEqual(updates);
    });

    it("should revalidate unchanged queries if forceCheckValidation is true", async () => {
      mockedTestQueryValidity.mockResolvedValue("bad query");
      const updates: Partial<DataSourceSettings> = {
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
          ],
        },
      };
      const new_updates = await validateExposureQueriesAndAddMissingIds(
        datasource,
        updates,
        true
      );
      expect(testQueryValidity).toHaveBeenCalled();
      const expected = updates;
      if (expected?.queries?.exposure) {
        expected.queries.exposure[0].error = "bad query";
      }
      expect(new_updates).toEqual(updates);
    });
  });

  describe("updateDataSource", () => {
    it("should throw an error if data sources are managed by config.yml", async () => {
      mockedUsingFileConfig.mockReturnValue(true);
      const updates: Partial<DataSourceInterface> = {
        name: "Updated Data Source",
      };
      await expect(
        //TODO: Create a helper function to create a mock datasource if we need to do this again
        updateDataSource(
          {
            org: {
              id: "test",
              name: "Test",
              url: "",
              ownerEmail: "",
              dateCreated: new Date(),
              members: [],
              invites: [],
              settings: {},
            },
            environments: [],
            readAccessFilter: FULL_ACCESS_PERMISSIONS,
          },
          datasource,
          updates
        )
      ).rejects.toThrow("Cannot update. Data sources managed by config.yml");
    });
  });
});
