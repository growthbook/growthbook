import request from "supertest";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { snapshotFactory } from "back-end/test/factories/Snapshot.factory";
import { ExperimentSnapshotModel } from "../../src/models/ExperimentSnapshotModel";
import { BaseModel, Context } from "../../src/models/BaseModel";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => {
  const ExperimentSnapshotModel = {
    getById: jest.fn(),
    getLatestSnapshot: jest.fn(),
  };
  return { ExperimentSnapshotModel: jest.fn(() => ExperimentSnapshotModel) };
});

describe("snapshots API", () => {
  const { app, setReqContext } = setupApp();

  afterEach(() => {
    jest.clearAllMocks();
  });

  const org = { id: "org" };
  const auditLogMock = jest.fn();

  const defaultContext = ({
    org,
    auditLog: auditLogMock,
  } as unknown) as Context;

  it("can get a snapshot", async () => {
    const experimentSnapshotModel = new ExperimentSnapshotModel(defaultContext);
    setReqContext({
      org,
      permissions: {
        canReadSingleProjectResource: () => true,
      },
      models: {
        experimentSnapshots: experimentSnapshotModel,
      },
    });

    const snapshot = snapshotFactory.build({
      organization: org.id,
    });

    const dangerousGetCollectionSpy = jest.spyOn(
      BaseModel.prototype,
      "_dangerousGetCollection"
    );

    dangerousGetCollectionSpy.mockImplementation(() => ({
      findOne: jest.fn().mockReturnValueOnce(snapshot),
    }));

    const getForeignRefsSpy = jest.spyOn(BaseModel.prototype, "getForeignRefs");
    getForeignRefsSpy.mockReturnValueOnce({
      experiment: { id: snapshot.experiment, project: "prj_1" },
    });
    // (experimentSnapshotModel.getById as jest.Mock).mockReturnValueOnce(
    //   snapshot
    // );

    const response = await request(app)
      .get("/api/v1/snapshots/snp_1")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      snapshot: {
        id: snapshot.id,
        experiment: snapshot.experiment,
        status: snapshot.status,
      },
    });
  });

  it("checks permission on experiment when getting a snapshot", async () => {
    const experimentSnapshotModel = new ExperimentSnapshotModel(defaultContext);
    setReqContext({
      org,
      permissions: {
        canReadSingleProjectResource: () => false,
      },
      models: {
        experimentSnapshots: experimentSnapshotModel,
      },
    });

    const snapshot = snapshotFactory.build({
      organization: org.id,
    });

    const dangerousGetCollectionSpy = jest.spyOn(
      BaseModel.prototype,
      "_dangerousGetCollection"
    );

    dangerousGetCollectionSpy.mockImplementation(() => ({
      findOne: jest.fn().mockReturnValueOnce(snapshot),
    }));

    const getForeignRefsSpy = jest.spyOn(BaseModel.prototype, "getForeignRefs");
    getForeignRefsSpy.mockReturnValueOnce({
      experiment: { id: snapshot.experiment, project: "prj_1" },
    });

    const response = await request(app)
      .get("/api/v1/snapshots/snp_1")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "Snapshot not found or no permission to access",
    });
  });

  // Cannot successfully mock createExperimentSnapshot from controllers/experiments
  // it("can post a snapshot", async () => {
  //   setReqContext({
  //     org,
  //     permissions: {
  //       canCreateExperimentSnapshot: () => true,
  //       canReadSingleProjectResource: () => true,
  //     },
  //   });

  //   const snapshot = snapshotFactory.build({
  //     organization: org.id,
  //   })

  //   getExperimentById.mockReturnValueOnce({ id: snapshot.experiment, datasource: "ds_123", phases: [0] });
  //   getDataSourceById.mockReturnValueOnce({ id: "ds_123" });
  //   createExperimentSnapshot.mockReturnValueOnce({snapshot: snapshot, queryRunner: {} });

  //   const response = await request(app)
  //     .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
  //     .set("Authorization", "Bearer foo");

  //   expect(response.status).toBe(200);
  //   expect(response.body).toEqual({
  //     snapshot: {
  //       id: snapshot.id,
  //       experiment: snapshot.experiment,
  //       status: snapshot.status,
  //     },
  //   });
  // });

  it("post fails without datasource permission", async () => {
    setReqContext({
      org,
      permissions: {
        canRunExperimentQueries: () => false,
        throwPermissionError: () => {
          throw new Error("permission error");
        },
      },
    });

    const snapshot = snapshotFactory.build({
      organization: org.id,
    });

    getExperimentById.mockReturnValueOnce({
      id: snapshot.experiment,
      datasource: "ds_123",
    });
    getDataSourceById.mockReturnValueOnce({ id: "ds_123" });

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "permission error" });
  });
});
