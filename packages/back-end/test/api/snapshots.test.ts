import request from "supertest";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { findDimensionById } from "back-end/src/models/DimensionModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  findSnapshotById,
  getLatestSuccessfulSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import {
  createExperimentSnapshot,
  createExperimentSnapshotFromPlan,
  planExperimentSnapshot,
} from "back-end/src/services/experiments";
import { ExperimentIncrementalPipelineRequiresFullRefreshError } from "back-end/src/util/errors";
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
  getLatestSuccessfulSnapshot: jest.fn(),
}));

jest.mock("back-end/src/services/experiments", () => ({
  createExperimentSnapshot: jest.fn(),
  createExperimentSnapshotFromPlan: jest.fn(),
  planExperimentSnapshot: jest.fn(),
}));

describe("snapshots API", () => {
  const { app, setReqContext } = setupApp();

  afterEach(() => {
    jest.clearAllMocks();
  });

  const org = { id: "org" };

  // Spelled out rather than imported: this copy is part of the 409 contract,
  // so changing it should fail here.
  const REQUIRES_FULL_REFRESH_GUIDANCE =
    'Send "dimension": "" to rebuild Overall Results, wait for that snapshot to finish, then resubmit this request unchanged.';
  const DIMENSION_ALREADY_UP_TO_DATE_GUIDANCE =
    'Send "dimension": "" to update Overall Results, wait for that snapshot to finish, then resubmit this request.';

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

  it("passes triggeredBy and zero-based phase when posting a snapshot", async () => {
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
    createExperimentSnapshot.mockResolvedValueOnce({
      snapshot,
      queryRunner: {},
    });

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo")
      .send({
        triggeredBy: "schedule",
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
      dimension: undefined,
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
        'Unknown dimension "pre:bogus". Supported built-in dimensions are "pre:date" and "pre:activation"',
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
    planExperimentSnapshot.mockResolvedValueOnce({
      runnerKind: "incremental-exploratory",
    });
    getLatestSuccessfulSnapshot.mockResolvedValueOnce(null);
    createExperimentSnapshotFromPlan.mockResolvedValueOnce({
      snapshot,
      queryRunner: {},
    });

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo")
      .send({ dimension: "exp:country" });

    expect(response.status).toBe(200);
    expect(findDimensionById).not.toHaveBeenCalled();
    expect(planExperimentSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ dimension: "exp:country" }),
    );
    expect(createExperimentSnapshotFromPlan).toHaveBeenCalledTimes(1);
  });

  describe("cutoff: and combo: dimensions", () => {
    const setupContext = () => {
      setReqContext({
        org,
        permissions: {
          canCreateExperimentSnapshot: () => true,
          canReadSingleProjectResource: () => true,
        },
      });
    };

    const buildFixtures = () => {
      const snapshot = snapshotFactory.build({ organization: org.id });
      const experiment = {
        id: snapshot.experiment,
        datasource: "ds_123",
        exposureQueryId: "eq_1",
        phases: [
          {
            dateStarted: new Date("2024-01-01T00:00:00.000Z"),
            dateEnded: new Date("2024-02-01T00:00:00.000Z"),
          },
        ],
      };
      const datasource = {
        id: "ds_123",
        settings: {
          queries: {
            exposure: [{ id: "eq_1", dimensions: ["country"] }],
          },
        },
      };
      return { snapshot, experiment, datasource };
    };

    const postDimension = (experimentId: string, dimension: string) =>
      request(app)
        .post(`/api/v1/experiments/${experimentId}/snapshot`)
        .set("Authorization", "Bearer foo")
        .send({ dimension });

    const mockHappyPath = (
      snapshot: ReturnType<typeof snapshotFactory.build>,
    ) => {
      planExperimentSnapshot.mockResolvedValueOnce({
        runnerKind: "incremental-exploratory",
      });
      getLatestSuccessfulSnapshot.mockResolvedValueOnce(null);
      createExperimentSnapshotFromPlan.mockResolvedValueOnce({
        snapshot,
        queryRunner: {},
      });
    };

    it("rejects a malformed cutoff datetime", async () => {
      setupContext();
      const { snapshot, experiment, datasource } = buildFixtures();
      getExperimentById.mockReturnValueOnce(experiment);
      getDataSourceById.mockReturnValueOnce(datasource);

      const response = await postDimension(
        snapshot.experiment,
        "cutoff:not-a-date",
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("Invalid cutoff datetime");
      expect(createExperimentSnapshotFromPlan).not.toHaveBeenCalled();
    });

    it("rejects a cutoff outside the phase window", async () => {
      setupContext();
      const { snapshot, experiment, datasource } = buildFixtures();
      getExperimentById.mockReturnValueOnce(experiment);
      getDataSourceById.mockReturnValueOnce(datasource);

      const response = await postDimension(
        snapshot.experiment,
        "cutoff:2024-03-01T00:00:00.000Z",
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toContain(
        "must fall within the experiment phase",
      );
      expect(createExperimentSnapshotFromPlan).not.toHaveBeenCalled();
    });

    it("accepts a cutoff within the phase window", async () => {
      setupContext();
      const { snapshot, experiment, datasource } = buildFixtures();
      getExperimentById.mockReturnValueOnce(experiment);
      getDataSourceById.mockReturnValueOnce(datasource);
      mockHappyPath(snapshot);

      const response = await postDimension(
        snapshot.experiment,
        "cutoff:2024-01-15T00:12:00.000Z",
      );

      expect(response.status).toBe(200);
      expect(planExperimentSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          dimension: "cutoff:2024-01-15T00:12:00.000Z",
        }),
      );
    });

    it("rejects a combo with an exp: constituent missing from the exposure query", async () => {
      setupContext();
      const { snapshot, experiment, datasource } = buildFixtures();
      getExperimentById.mockReturnValueOnce(experiment);
      getDataSourceById.mockReturnValueOnce(datasource);

      const response = await postDimension(
        snapshot.experiment,
        "combo:exp:browser::exp:country",
      );

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message:
          'Experiment dimension "browser" is not available on the experiment\'s exposure query.',
      });
      expect(createExperimentSnapshotFromPlan).not.toHaveBeenCalled();
    });

    it("rejects a combo with a missing unit dimension", async () => {
      setupContext();
      const { snapshot, experiment, datasource } = buildFixtures();
      getExperimentById.mockReturnValueOnce(experiment);
      getDataSourceById.mockReturnValueOnce(datasource);
      findDimensionById.mockResolvedValueOnce(null);

      const response = await postDimension(
        snapshot.experiment,
        "combo:exp:country::dim_missing",
      );

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: "Dimension dim_missing not found",
      });
      expect(createExperimentSnapshotFromPlan).not.toHaveBeenCalled();
    });

    it("rejects a combo with a unit dimension from another datasource", async () => {
      setupContext();
      const { snapshot, experiment, datasource } = buildFixtures();
      getExperimentById.mockReturnValueOnce(experiment);
      getDataSourceById.mockReturnValueOnce(datasource);
      findDimensionById.mockResolvedValueOnce({
        id: "dim_other",
        datasource: "ds_other",
      });

      const response = await postDimension(
        snapshot.experiment,
        "combo:exp:country::dim_other",
      );

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message:
          "Dimension dim_other belongs to a different data source than this experiment.",
      });
      expect(createExperimentSnapshotFromPlan).not.toHaveBeenCalled();
    });

    it("rejects malformed combos", async () => {
      setupContext();
      const { snapshot, experiment, datasource } = buildFixtures();

      for (const dimension of [
        "combo:exp:country",
        "combo:dim_a::dim_b::dim_c",
        "combo:dim_a::dim_a",
        "combo:pre:date::dim_a",
      ]) {
        getExperimentById.mockReturnValueOnce(experiment);
        getDataSourceById.mockReturnValueOnce(datasource);
        const response = await postDimension(snapshot.experiment, dimension);
        expect(response.status).toBe(400);
      }
      expect(createExperimentSnapshotFromPlan).not.toHaveBeenCalled();
    });

    it("accepts a valid combo of an experiment and a unit dimension", async () => {
      setupContext();
      const { snapshot, experiment, datasource } = buildFixtures();
      getExperimentById.mockReturnValueOnce(experiment);
      getDataSourceById.mockReturnValueOnce(datasource);
      findDimensionById.mockResolvedValueOnce({
        id: "dim_abc",
        datasource: "ds_123",
      });
      mockHappyPath(snapshot);

      const response = await postDimension(
        snapshot.experiment,
        "combo:exp:country::dim_abc",
      );

      expect(response.status).toBe(200);
      expect(findDimensionById).toHaveBeenCalledWith("dim_abc", org.id);
      expect(planExperimentSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ dimension: "combo:exp:country::dim_abc" }),
      );
    });
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

  it("auto-promotes a non-forced request when a full refresh is required", async () => {
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
    const staleConfigMessage =
      "The experiment configuration is outdated. Please run a Full Refresh.";

    getExperimentById.mockReturnValueOnce(experiment);
    getDataSourceById.mockReturnValueOnce({ id: "ds_123" });
    createExperimentSnapshot
      .mockRejectedValueOnce(
        new ExperimentIncrementalPipelineRequiresFullRefreshError(
          staleConfigMessage,
        ),
      )
      .mockResolvedValueOnce({ snapshot, queryRunner: {} });

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(createExperimentSnapshot).toHaveBeenCalledTimes(2);
    expect(createExperimentSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ useCache: false }),
    );
  });

  const incrementalDatasource = {
    id: "ds_123",
    settings: {
      pipelineSettings: {
        allowWriting: true,
        mode: "incremental" as const,
      },
      queries: {
        exposure: [{ id: "eq_1", dimensions: ["country"] }],
      },
    },
  };

  it.each([
    [
      "Overall Results are missing",
      "Overall Results have not been computed yet, so there is no units table for a dimension breakdown to read.",
    ],
    [
      "Overall Results are stale",
      "Overall Results require a full refresh before Dimension Results can be updated.",
    ],
  ])(
    "returns 409 requires_full_refresh when %s",
    async (_, dimensionFullRefreshMessage) => {
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
        exposureQueryId: "eq_1",
        phases: [{}],
      };

      getExperimentById.mockReturnValueOnce(experiment);
      getDataSourceById.mockReturnValueOnce(incrementalDatasource);
      planExperimentSnapshot.mockRejectedValueOnce(
        new ExperimentIncrementalPipelineRequiresFullRefreshError(
          dimensionFullRefreshMessage,
        ),
      );
      const response = await request(app)
        .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
        .set("Authorization", "Bearer foo")
        .send({ dimension: "exp:country" });

      const guidedMessage = `${dimensionFullRefreshMessage} ${REQUIRES_FULL_REFRESH_GUIDANCE}`;

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        message: guidedMessage,
        code: "requires_full_refresh",
        details: {
          reason: guidedMessage,
        },
      });
      // The request path forces the full-refresh contract regardless of the
      // triggeredBy the caller sent, so a "schedule" caller cannot opt out.
      expect(planExperimentSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ throwIfRequiresFullRefresh: true }),
      );
      expect(createExperimentSnapshotFromPlan).not.toHaveBeenCalled();
      expect(createExperimentSnapshot).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["manual", undefined],
    ["scheduled", "schedule" as const],
  ])(
    "returns 409 dimension_already_up_to_date for a %s dimension request already computed from the latest Overall Results",
    async (_, triggeredBy) => {
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

      getExperimentById.mockReturnValueOnce(experiment);
      getDataSourceById.mockReturnValueOnce(incrementalDatasource);
      const analysisSettings = { differenceType: "relative" as const };
      const overallResultsAsOf = new Date("2026-08-03T20:11:46.755Z");
      planExperimentSnapshot.mockResolvedValueOnce({
        runnerKind: "incremental-exploratory",
        snapshot: {
          sourceSnapshotId: "snp_src",
          sourceSnapshotDateCreated: overallResultsAsOf,
          analyses: [{ settings: analysisSettings }],
        },
      });
      getLatestSuccessfulSnapshot.mockResolvedValueOnce({
        id: "snp_dim",
        sourceSnapshotId: "snp_src",
        analyses: [{ status: "success", settings: analysisSettings }],
      });

      const response = await request(app)
        .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
        .set("Authorization", "Bearer foo")
        .send({ dimension: "exp:country", triggeredBy });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        message: `These results were computed from Overall Results as of ${overallResultsAsOf.toISOString()}. ${DIMENSION_ALREADY_UP_TO_DATE_GUIDANCE}`,
        code: "dimension_already_up_to_date",
        details: { overallResultsAsOf: overallResultsAsOf.toISOString() },
      });
      expect(planExperimentSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredBy }),
      );
      expect(getLatestSuccessfulSnapshot).toHaveBeenCalledTimes(1);
      expect(getLatestSuccessfulSnapshot).toHaveBeenCalledWith({
        context: expect.objectContaining({ org }),
        experiment: experiment.id,
        phase: 0,
        dimension: "exp:country",
      });
      expect(createExperimentSnapshotFromPlan).not.toHaveBeenCalled();
    },
  );

  it("recomputes a dimension from the same Overall Results when its analysis settings changed", async () => {
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

    getExperimentById.mockReturnValueOnce(experiment);
    getDataSourceById.mockReturnValueOnce(incrementalDatasource);
    planExperimentSnapshot.mockResolvedValueOnce({
      runnerKind: "incremental-exploratory",
      snapshot: {
        sourceSnapshotId: "snp_src",
        analyses: [
          {
            settings: {
              differenceType: "relative",
              pValueThreshold: 0.05,
            },
          },
        ],
      },
    });
    getLatestSuccessfulSnapshot.mockResolvedValueOnce({
      id: "snp_dim",
      sourceSnapshotId: "snp_src",
      analyses: [
        {
          status: "success",
          settings: {
            differenceType: "relative",
            pValueThreshold: 0.01,
          },
        },
      ],
    });
    createExperimentSnapshotFromPlan.mockResolvedValueOnce({
      snapshot,
      queryRunner: {},
    });

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo")
      .send({ dimension: "exp:country" });

    expect(response.status).toBe(200);
    expect(createExperimentSnapshotFromPlan).toHaveBeenCalledTimes(1);
  });

  it("runs the dimension snapshot when the plan reads a different Overall Results run than the last breakdown did", async () => {
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

    getExperimentById.mockReturnValueOnce(experiment);
    getDataSourceById.mockReturnValueOnce(incrementalDatasource);
    planExperimentSnapshot.mockResolvedValueOnce({
      runnerKind: "incremental-exploratory",
      snapshot: { sourceSnapshotId: "snp_src_new" },
    });
    getLatestSuccessfulSnapshot.mockResolvedValueOnce({
      id: "snp_dim",
      sourceSnapshotId: "snp_src_old",
    });
    createExperimentSnapshotFromPlan.mockResolvedValueOnce({
      snapshot,
      queryRunner: {},
    });

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo")
      .send({ dimension: "exp:country" });

    expect(response.status).toBe(200);
    expect(createExperimentSnapshotFromPlan).toHaveBeenCalledTimes(1);
  });

  it("runs the dimension snapshot when the plan is not incremental, even if a prior breakdown recorded a source", async () => {
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

    getExperimentById.mockReturnValueOnce(experiment);
    getDataSourceById.mockReturnValueOnce(incrementalDatasource);
    planExperimentSnapshot.mockResolvedValueOnce({
      runnerKind: "results",
      snapshot: {},
    });
    getLatestSuccessfulSnapshot.mockResolvedValueOnce({
      id: "snp_dim",
      sourceSnapshotId: "snp_src",
    });
    createExperimentSnapshotFromPlan.mockResolvedValueOnce({
      snapshot,
      queryRunner: {},
    });

    const response = await request(app)
      .post(`/api/v1/experiments/${snapshot.experiment}/snapshot`)
      .set("Authorization", "Bearer foo")
      .send({ dimension: "exp:country" });

    expect(response.status).toBe(200);
    expect(createExperimentSnapshotFromPlan).toHaveBeenCalledTimes(1);
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
    expect(createExperimentSnapshot).not.toHaveBeenCalled();
  });
});
