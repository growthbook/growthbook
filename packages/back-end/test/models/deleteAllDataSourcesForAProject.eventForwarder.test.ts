import mongoose from "mongoose";
import { Permissions, roleToPermissionMap } from "shared/permissions";
import { OrganizationInterface } from "shared/types/organization";
import { deleteAllDataSourcesForAProject } from "back-end/src/models/DataSourceModel";
import * as lifecycle from "back-end/src/services/eventForwarder/datasourceLifecycle";
import * as configInit from "back-end/src/init/config";
import { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/init/config");
jest.mock("back-end/src/services/eventForwarder/datasourceLifecycle");

const mockedUsingFileConfig = configInit.usingFileConfig as jest.MockedFunction<
  typeof configInit.usingFileConfig
>;
const syncMock =
  lifecycle.syncEventForwarderAfterDatasourceDeleted as jest.MockedFunction<
    typeof lifecycle.syncEventForwarderAfterDatasourceDeleted
  >;

function fakeDsDoc(id: string) {
  return {
    toJSON: () => ({
      id,
      organization: "org1",
      name: "ds",
      type: "postgres",
      description: "",
      params: "params",
      settings: {},
      projects: ["proj1"],
      dateCreated: new Date(),
      dateUpdated: new Date(),
    }),
  };
}

describe("deleteAllDataSourcesForAProject (event forwarder)", () => {
  const org: OrganizationInterface = {
    id: "org1",
    name: "Org",
    url: "",
    ownerEmail: "",
    dateCreated: new Date(),
    members: [],
    invites: [],
    settings: {},
  };

  const context = {
    org,
    permissions: new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", org),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    }),
  } as unknown as ReqContext;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUsingFileConfig.mockReturnValue(false);
    syncMock.mockResolvedValue(undefined);
  });

  it("runs syncEventForwarderAfterDatasourceDeleted once per matched datasource before deleteMany", async () => {
    const Model = mongoose.models.DataSource;
    expect(Model).toBeDefined();

    const findSpy = jest
      .spyOn(Model, "find")
      .mockResolvedValue([fakeDsDoc("ds_a"), fakeDsDoc("ds_b")] as never);
    const deleteManySpy = jest
      .spyOn(Model, "deleteMany")
      .mockResolvedValue({ deletedCount: 2 } as never);

    await deleteAllDataSourcesForAProject({
      context,
      projectId: "proj1",
      organizationId: "org1",
    });

    expect(syncMock).toHaveBeenCalledTimes(2);
    expect(syncMock.mock.calls[0][1].id).toBe("ds_a");
    expect(syncMock.mock.calls[1][1].id).toBe("ds_b");
    expect(deleteManySpy).toHaveBeenCalledWith({
      organization: "org1",
      projects: ["proj1"],
    });

    findSpy.mockRestore();
    deleteManySpy.mockRestore();
  });
});
