import { ObjectId } from "mongodb";
import {
  updateDataSource,
  DataSourceModel,
} from "../../src/models/DataSourceModel";
import { DataSourceInterface } from "../../types/datasource";
import { testQueryValidity } from "../../src/services/datasource";
import { usingFileConfig } from "../../src/init/config";

jest.mock("../../src/services/datasource");
jest.mock("../../src/init/config");

describe("updateDataSource", () => {
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

    jest.spyOn(DataSourceModel, "updateOne").mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: new ObjectId("5f2b3b2b0b9a7c0d3c9d9a1a"),
    });
  });

  it("should not update if no changes are made", async () => {
    const updates: Partial<DataSourceInterface> = {};
    await updateDataSource(datasource, "test", updates);
    expect(DataSourceModel.updateOne).not.toHaveBeenCalled();
  });

  it("should not update if what it is trying to update is the same as current datasource", async () => {
    const updates: Partial<DataSourceInterface> = {
      dateUpdated: new Date(),
      name: "Test Data Source",
    };
    await updateDataSource(datasource, "test", updates);
    expect(DataSourceModel.updateOne).not.toHaveBeenCalled();
  });

  it("should update if changes are made", async () => {
    const updates: Partial<DataSourceInterface> = {
      name: "Updated Data Source",
    };
    await updateDataSource(datasource, "test", updates);
    expect(DataSourceModel.updateOne).toHaveBeenCalledWith(
      {
        id: datasource.id,
        organization: "test",
      },
      {
        $set: {
          name: "Updated Data Source",
        },
      }
    );
  });

  it("should add missing exposure query ids and validate new queries", async () => {
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
    await updateDataSource(datasource, "test", updates);
    expect(testQueryValidity).toHaveBeenCalledWith(
      datasource,
      "SELECT new_id FROM experiment_viewed"
    );
    expect(DataSourceModel.updateOne).toHaveBeenCalledWith(
      {
        id: datasource.id,
        organization: "test",
      },
      {
        $set: {
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
        },
      }
    );
  });

  it("should validate previously errored queries", async () => {
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
    await updateDataSource(datasource, "test", updates);
    expect(testQueryValidity).toHaveBeenCalledWith(
      datasource,
      "SELECT bad query"
    );
  });

  it("should validate previously changed queries", async () => {
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
    await updateDataSource(datasource, "test", updates);
    expect(testQueryValidity).toHaveBeenCalledWith(
      datasource,
      "SELECT changed_anonymous_id FROM experiment_viewed"
    );
  });

  it("should throw an error if data sources are managed by config.yml", async () => {
    // @ts-expect-error - not sure why it doesn't realize usingFileConfig is a mock
    usingFileConfig.mockReturnValue(true);
    const updates: Partial<DataSourceInterface> = {
      name: "Updated Data Source",
    };
    await expect(updateDataSource(datasource, "test", updates)).rejects.toThrow(
      "Cannot update. Data sources managed by config.yml"
    );
    expect(DataSourceModel.updateOne).not.toHaveBeenCalled();
  });
});
