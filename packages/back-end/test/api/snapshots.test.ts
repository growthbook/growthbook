import request from "supertest";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import { snapshotFactory } from "back-end/test/factories/Snapshot.factory";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  findSnapshotById: jest.fn(),
}));

describe("snapshots API", () => {
  const { app, setReqContext } = setupApp();

  afterEach(() => {
    jest.clearAllMocks();
  });

  const org = { id: "org" };

  it("can get a snapshot", async () => {
    setReqContext({
      org,
      permissions: {
        canReadSingleProjectResource: () => true,
      },
    });

    const snapshot = snapshotFactory.build({
      organization: org.id,
    });

    findSnapshotById.mockReturnValueOnce(snapshot);
    getExperimentById.mockReturnValueOnce({ id: snapshot.experiment });

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
    setReqContext({
      org,
      permissions: {
        canReadSingleProjectResource: () => false,
      },
    });

    const snapshot = snapshotFactory.build({
      organization: org.id,
    });

    // check is on getExperimentById, not findSnapshotById
    findSnapshotById.mockReturnValueOnce(snapshot);

    const response = await request(app)
      .get("/api/v1/snapshots/snp_1")
      .set("Authorization", "Bearer foo");
    console.log(response.body);

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
        canCreateExperimentSnapshot: () => false,
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
