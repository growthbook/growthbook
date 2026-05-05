import request from "supertest";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { findDimensionById } from "back-end/src/models/DimensionModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import { createExperimentSnapshot } from "back-end/src/services/experiments";
import { snapshotFactory } from "back-end/test/factories/Snapshot.factory";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

jest.mock("back-end/src/models/DimensionModel", () => ({
  findDimensionById: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  findSnapshotById: jest.fn(),
}));

jest.mock("back-end/src/services/experiments", () => ({
  createExperimentSnapshot: jest.fn(),
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

  it("defaults to the last phase with no dimension when no body is sent", async () => {
    setReqContext({
      org,
      permissions: {
        canCreateExperimentSnapshot: () => true,
        canReadSingleProjectResource: () => true,
      },
    });

    const snapshot = snapshotFactory.build({
      organization: org.id,
    });
    const experiment = {
      id: snapshot.experiment,
      datasource: "ds_123",
      phases: [{}, {}, {}],
    };
    const datasource = { id: "ds_123" };

    getExperimentById.mockReturnValueOnce(experiment);
    getDataSourceById.mockReturnValueOnce(datasource);
    createExperimentSnapshot.mockResolvedValueOnce({
      snapshot,
      queryRunner: {},
    });

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      snapshot: {
        id: snapshot.id,
        experiment: snapshot.experiment,
        status: snapshot.status,
      },
    });
    expect(createExperimentSnapshot).toHaveBeenCalledWith({
      context: expect.objectContaining({ org }),
      experiment,
      datasource,
      triggeredBy: undefined,
      phase: 2,
      dimension: undefined,
      useCache: true,
    });
  });

  it("passes dimension and zero-based phase when posting a snapshot", async () => {
    setReqContext({
      org,
      permissions: {
        canCreateExperimentSnapshot: () => true,
        canReadSingleProjectResource: () => true,
      },
    });

    const snapshot = snapshotFactory.build({
      organization: org.id,
    });
    const experiment = {
      id: snapshot.experiment,
      datasource: "ds_123",
      phases: [{}, {}],
    };
    const datasource = { id: "ds_123" };

    getExperimentById.mockReturnValueOnce(experiment);
    getDataSourceById.mockReturnValueOnce(datasource);
    findDimensionById.mockResolvedValueOnce({ id: "dim_123" });
    createExperimentSnapshot.mockResolvedValueOnce({
      snapshot,
      queryRunner: {},
    });

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo")
      .send({
        triggeredBy: "schedule",
        dimension: "dim_123",
        phase: 0,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      snapshot: {
        id: snapshot.id,
        experiment: snapshot.experiment,
        status: snapshot.status,
      },
    });
    expect(createExperimentSnapshot).toHaveBeenCalledWith({
      context: expect.objectContaining({ org }),
      experiment,
      datasource,
      triggeredBy: "schedule",
      phase: 0,
      dimension: "dim_123",
      useCache: true,
    });
  });

  it("rejects a dimension that does not exist", async () => {
    setReqContext({
      org,
      permissions: {
        canCreateExperimentSnapshot: () => true,
        canReadSingleProjectResource: () => true,
      },
    });

    const snapshot = snapshotFactory.build({
      organization: org.id,
    });
    const experiment = {
      id: snapshot.experiment,
      datasource: "ds_123",
      phases: [{}],
    };

    getExperimentById.mockReturnValueOnce(experiment);
    getDataSourceById.mockReturnValueOnce({ id: "ds_123" });
    findDimensionById.mockResolvedValueOnce(null);

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo")
      .send({ dimension: "dim_missing" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "Dimension dim_missing not found",
    });
    expect(findDimensionById).toHaveBeenCalledWith("dim_missing", org.id);
    expect(createExperimentSnapshot).not.toHaveBeenCalled();
  });

  it("rejects pre:activation when the experiment has no activation metric", async () => {
    setReqContext({
      org,
      permissions: {
        canCreateExperimentSnapshot: () => true,
        canReadSingleProjectResource: () => true,
      },
    });

    const snapshot = snapshotFactory.build({ organization: org.id });
    const experiment = {
      id: snapshot.experiment,
      datasource: "ds_123",
      phases: [{}],
      activationMetric: undefined,
    };

    getExperimentById.mockReturnValueOnce(experiment);
    getDataSourceById.mockReturnValueOnce({ id: "ds_123" });

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo")
      .send({ dimension: "pre:activation" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message:
        'Cannot use "pre:activation" because this experiment has no activation metric configured.',
    });
    expect(findDimensionById).not.toHaveBeenCalled();
    expect(createExperimentSnapshot).not.toHaveBeenCalled();
  });

  it("rejects an unsupported pre: dimension", async () => {
    setReqContext({
      org,
      permissions: {
        canCreateExperimentSnapshot: () => true,
        canReadSingleProjectResource: () => true,
      },
    });

    const snapshot = snapshotFactory.build({ organization: org.id });
    const experiment = {
      id: snapshot.experiment,
      datasource: "ds_123",
      phases: [{}],
    };

    getExperimentById.mockReturnValueOnce(experiment);
    getDataSourceById.mockReturnValueOnce({ id: "ds_123" });

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo")
      .send({ dimension: "pre:bogus" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message:
        'Pre-exposure dimension "pre:bogus" is not supported. Use "pre:date" or "pre:activation".',
    });
    expect(createExperimentSnapshot).not.toHaveBeenCalled();
  });

  it("rejects an exp: dimension that is not on the exposure query", async () => {
    setReqContext({
      org,
      permissions: {
        canCreateExperimentSnapshot: () => true,
        canReadSingleProjectResource: () => true,
      },
    });

    const snapshot = snapshotFactory.build({ organization: org.id });
    const experiment = {
      id: snapshot.experiment,
      datasource: "ds_123",
      exposureQueryId: "eq_1",
      phases: [{}],
    };
    const datasource = {
      id: "ds_123",
      settings: {
        queries: {
          exposure: [{ id: "eq_1", dimensions: ["country"] }],
        },
      },
    };

    getExperimentById.mockReturnValueOnce(experiment);
    getDataSourceById.mockReturnValueOnce(datasource);

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo")
      .send({ dimension: "exp:browser" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message:
        'Experiment dimension "browser" is not available on the experiment\'s exposure query.',
    });
    expect(createExperimentSnapshot).not.toHaveBeenCalled();
  });

  it("accepts an exp: dimension that is on the exposure query", async () => {
    setReqContext({
      org,
      permissions: {
        canCreateExperimentSnapshot: () => true,
        canReadSingleProjectResource: () => true,
      },
    });

    const snapshot = snapshotFactory.build({ organization: org.id });
    const experiment = {
      id: snapshot.experiment,
      datasource: "ds_123",
      exposureQueryId: "eq_1",
      phases: [{}],
    };
    const datasource = {
      id: "ds_123",
      settings: {
        queries: {
          exposure: [{ id: "eq_1", dimensions: ["country"] }],
        },
      },
    };

    getExperimentById.mockReturnValueOnce(experiment);
    getDataSourceById.mockReturnValueOnce(datasource);
    createExperimentSnapshot.mockResolvedValueOnce({
      snapshot,
      queryRunner: {},
    });

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo")
      .send({ dimension: "exp:country" });

    expect(response.status).toBe(200);
    expect(findDimensionById).not.toHaveBeenCalled();
    expect(createExperimentSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ dimension: "exp:country" }),
    );
  });

  it("rejects an out-of-range phase index", async () => {
    setReqContext({
      org,
      permissions: {
        canCreateExperimentSnapshot: () => true,
        canReadSingleProjectResource: () => true,
      },
    });

    const snapshot = snapshotFactory.build({
      organization: org.id,
    });
    const experiment = {
      id: snapshot.experiment,
      datasource: "ds_123",
      phases: [{}],
    };

    getExperimentById.mockReturnValueOnce(experiment);
    getDataSourceById.mockReturnValueOnce({ id: "ds_123" });

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo")
      .send({ phase: 5 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Phase 5 not found" });
    expect(createExperimentSnapshot).not.toHaveBeenCalled();
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
