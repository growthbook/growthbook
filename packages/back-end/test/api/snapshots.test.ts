import request from "supertest";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import {
  requestExperimentSnapshot,
  waitForSnapshotExecution,
} from "back-end/src/services/experiments";
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

jest.mock("back-end/src/services/experiments", () => ({
  requestExperimentSnapshot: jest.fn(),
  waitForSnapshotExecution: jest.fn(),
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

  it("can post a snapshot and wait for terminal execution", async () => {
    setReqContext({
      org,
      permissions: {
        canCreateExperimentSnapshot: () => true,
        canReadSingleProjectResource: () => true,
      },
    });

    const initialSnapshot = snapshotFactory.build({
      organization: org.id,
      status: "running",
      executionMetadata: {
        id: "snp_1",
        mode: "writer",
        heartbeat: new Date(),
        intent: {},
      },
    });
    const finalSnapshot = {
      ...initialSnapshot,
      status: "success" as const,
    };

    getExperimentById.mockReturnValueOnce({
      id: initialSnapshot.experiment,
      datasource: "ds_123",
      status: "running",
      phases: [{}],
    });
    getDataSourceById.mockReturnValueOnce({ id: "ds_123" });
    requestExperimentSnapshot.mockResolvedValueOnce({
      snapshot: initialSnapshot,
    });
    waitForSnapshotExecution.mockResolvedValueOnce(finalSnapshot);

    const response = await request(app)
      .post(`/api/v1/experiments/${initialSnapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo");

    expect(requestExperimentSnapshot).toHaveBeenCalled();
    expect(waitForSnapshotExecution).toHaveBeenCalledWith({
      context: expect.anything(),
      snapshotId: initialSnapshot.id,
      timeoutMs: 30 * 60 * 1000,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      snapshot: {
        id: finalSnapshot.id,
        experiment: finalSnapshot.experiment,
        status: finalSnapshot.status,
      },
    });
  });

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
