import request from "supertest";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getContextualBanditResultsForUi } from "back-end/src/enterprise/services/contextualBandits";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));

jest.mock("back-end/src/enterprise/services/contextualBandits", () => ({
  getContextualBanditResultsForUi: jest.fn(),
}));

describe("contextual bandit results & phase API", () => {
  const { app, setReqContext } = setupApp();
  const org = { id: "org_cb" };

  const patchPhaseWeights = jest.fn();
  const getByExperimentId = jest.fn();

  const cbDoc = {
    id: "cb_1",
    experiment: "exp_cb",
    phases: [
      {
        dateStarted: new Date("2026-01-01T00:00:00.000Z"),
        dateEnded: null,
        currentLeafWeights: [{ contextId: "ctx_a", weights: [0.5, 0.5] }],
      },
      {
        dateStarted: new Date("2026-02-01T00:00:00.000Z"),
        dateEnded: null,
        currentLeafWeights: [],
      },
    ],
  };

  const baseContext = {
    org,
    hasPremiumFeature: () => true,
    throwPlanDoesNotAllowError: (message: string) => {
      throw Object.assign(new Error(message), { status: 403 });
    },
    permissions: {
      canReadSingleProjectResource: () => true,
      canRunExperiment: () => true,
      throwPermissionError: () => {
        throw Object.assign(new Error("Permission denied"), { status: 403 });
      },
    },
    models: {
      contextualBandits: {
        getByExperimentId,
        patchPhaseWeights,
      },
    },
  };

  beforeEach(() => {
    setReqContext(baseContext);
    getByExperimentId.mockReset();
    patchPhaseWeights.mockReset();
    getByExperimentId.mockResolvedValue(cbDoc);
    patchPhaseWeights.mockImplementation(
      async (_cbId: string, phaseIndex: number, weights) => ({
        ...cbDoc,
        phases: cbDoc.phases.map((p, i) =>
          i === phaseIndex ? { ...p, currentLeafWeights: weights } : p,
        ),
      }),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /experiments/:id/contextual-bandit/results", () => {
    it("rejects orgs without the contextual-bandits premium feature", async () => {
      setReqContext({ ...baseContext, hasPremiumFeature: () => false });

      const response = await request(app)
        .get("/api/v1/experiments/exp_cb/contextual-bandit/results")
        .set("Authorization", "Bearer foo");

      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/contextual bandits.*enterprise/i);
      expect(getExperimentById).not.toHaveBeenCalled();
      expect(getContextualBanditResultsForUi).not.toHaveBeenCalled();
    });

    it("rejects users without read access on the parent project", async () => {
      setReqContext({
        ...baseContext,
        permissions: {
          ...baseContext.permissions,
          canReadSingleProjectResource: () => false,
        },
      });

      getExperimentById.mockResolvedValueOnce({
        id: "exp_cb",
        type: "contextual-bandit",
        project: "proj_a",
        phases: [{ dateStarted: new Date() }],
      });

      const response = await request(app)
        .get("/api/v1/experiments/exp_cb/contextual-bandit/results")
        .set("Authorization", "Bearer foo");

      expect(response.status).toBe(403);
      expect(getContextualBanditResultsForUi).not.toHaveBeenCalled();
    });

    it("returns 400 when the experiment is missing", async () => {
      getExperimentById.mockResolvedValueOnce(null);

      const response = await request(app)
        .get("/api/v1/experiments/exp_missing/contextual-bandit/results")
        .set("Authorization", "Bearer foo");

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/find experiment/i);
      expect(getContextualBanditResultsForUi).not.toHaveBeenCalled();
    });

    it("rejects experiments that are not contextual bandits", async () => {
      getExperimentById.mockResolvedValueOnce({
        id: "exp_std",
        type: "multi-armed-bandit",
        project: "proj_a",
        phases: [{ dateStarted: new Date() }],
      });

      const response = await request(app)
        .get("/api/v1/experiments/exp_std/contextual-bandit/results")
        .set("Authorization", "Bearer foo");

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/not a contextual bandit/i);
      expect(getContextualBanditResultsForUi).not.toHaveBeenCalled();
    });

    it("returns the same shape as the internal results endpoint, with dates as ISO strings", async () => {
      getExperimentById.mockResolvedValueOnce({
        id: "exp_cb",
        type: "contextual-bandit",
        project: "proj_a",
        phases: [{ dateStarted: new Date() }],
      });

      const runStarted = new Date("2026-01-02T03:04:05.000Z");
      const dateCreated = new Date("2026-01-02T03:04:06.000Z");
      getContextualBanditResultsForUi.mockResolvedValueOnce({
        contextualBanditSnapshot: {
          attributes: ["country"],
          responses: [
            {
              context: { country: "US" },
              sampleSizePerVariation: [120, 130],
              updatedWeights: [0.4, 0.6],
            },
          ],
          leaf_map: [{ context: { country: "US" }, leafId: 0 }],
        },
        latest: {
          id: "cbs_1",
          status: "success",
          error: "",
          queries: [
            {
              name: "contextual-bandit-rows",
              query: "q_1",
              status: "succeeded",
            },
          ],
          runStarted,
          dateCreated,
          multipleExposures: 0,
          type: "standard",
          triggeredBy: "manual",
        },
      });

      const response = await request(app)
        .get("/api/v1/experiments/exp_cb/contextual-bandit/results")
        .set("Authorization", "Bearer foo");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        contextualBanditSnapshot: {
          attributes: ["country"],
          responses: [
            {
              context: { country: "US" },
              sampleSizePerVariation: [120, 130],
              updatedWeights: [0.4, 0.6],
            },
          ],
          leaf_map: [{ context: { country: "US" }, leafId: 0 }],
        },
        latest: {
          id: "cbs_1",
          status: "success",
          error: "",
          queries: [
            {
              name: "contextual-bandit-rows",
              query: "q_1",
              status: "succeeded",
            },
          ],
          runStarted: runStarted.toISOString(),
          dateCreated: dateCreated.toISOString(),
          multipleExposures: 0,
          type: "standard",
          triggeredBy: "manual",
        },
      });

      expect(getContextualBanditResultsForUi).toHaveBeenCalledWith(
        expect.objectContaining({ org }),
        expect.objectContaining({ id: "exp_cb" }),
      );
    });

    it("returns nulls when no snapshot or event has been produced yet", async () => {
      getExperimentById.mockResolvedValueOnce({
        id: "exp_cb_empty",
        type: "contextual-bandit",
        project: "proj_a",
        phases: [{ dateStarted: new Date() }],
      });
      getContextualBanditResultsForUi.mockResolvedValueOnce({
        contextualBanditSnapshot: null,
        latest: null,
      });

      const response = await request(app)
        .get("/api/v1/experiments/exp_cb_empty/contextual-bandit/results")
        .set("Authorization", "Bearer foo");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        contextualBanditSnapshot: null,
        latest: null,
      });
    });
  });

  describe("PUT /experiments/:id/contextual-bandit/phase/:phase", () => {
    it("rejects orgs without the contextual-bandits premium feature", async () => {
      setReqContext({ ...baseContext, hasPremiumFeature: () => false });

      const response = await request(app)
        .put("/api/v1/experiments/exp_cb/contextual-bandit/phase/0")
        .set("Authorization", "Bearer foo")
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/contextual bandits.*enterprise/i);
      expect(getExperimentById).not.toHaveBeenCalled();
      expect(patchPhaseWeights).not.toHaveBeenCalled();
    });

    it("rejects users without canRunExperiment on the parent experiment", async () => {
      setReqContext({
        ...baseContext,
        permissions: {
          ...baseContext.permissions,
          canRunExperiment: () => false,
        },
      });
      getExperimentById.mockResolvedValueOnce({
        id: "exp_cb",
        type: "contextual-bandit",
        project: "proj_a",
        environments: ["production"],
        phases: cbDoc.phases,
      });

      const response = await request(app)
        .put("/api/v1/experiments/exp_cb/contextual-bandit/phase/0")
        .set("Authorization", "Bearer foo")
        .send({
          currentLeafWeights: [{ contextId: "ctx_a", weights: [0.3, 0.7] }],
        });

      expect(response.status).toBe(403);
      expect(patchPhaseWeights).not.toHaveBeenCalled();
    });

    it("rejects experiments that are not contextual bandits", async () => {
      getExperimentById.mockResolvedValueOnce({
        id: "exp_std",
        type: "multi-armed-bandit",
        project: "proj_a",
        phases: cbDoc.phases,
      });

      const response = await request(app)
        .put("/api/v1/experiments/exp_std/contextual-bandit/phase/0")
        .set("Authorization", "Bearer foo")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/not a contextual bandit/i);
      expect(patchPhaseWeights).not.toHaveBeenCalled();
    });

    it("rejects an out-of-range phase index", async () => {
      getExperimentById.mockResolvedValueOnce({
        id: "exp_cb",
        type: "contextual-bandit",
        project: "proj_a",
        environments: ["production"],
        phases: cbDoc.phases,
      });

      const response = await request(app)
        .put("/api/v1/experiments/exp_cb/contextual-bandit/phase/9")
        .set("Authorization", "Bearer foo")
        .send({
          currentLeafWeights: [{ contextId: "ctx_a", weights: [0.5, 0.5] }],
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/out of range/i);
      expect(patchPhaseWeights).not.toHaveBeenCalled();
    });

    it("rejects body fields outside the strict allowlist", async () => {
      getExperimentById.mockResolvedValueOnce({
        id: "exp_cb",
        type: "contextual-bandit",
        project: "proj_a",
        environments: ["production"],
        phases: cbDoc.phases,
      });

      const response = await request(app)
        .put("/api/v1/experiments/exp_cb/contextual-bandit/phase/0")
        .set("Authorization", "Bearer foo")
        .send({ status: "stopped" });

      expect(response.status).toBe(400);
      expect(patchPhaseWeights).not.toHaveBeenCalled();
    });

    it("updates currentLeafWeights and returns the updated phase", async () => {
      getExperimentById.mockResolvedValueOnce({
        id: "exp_cb",
        type: "contextual-bandit",
        project: "proj_a",
        environments: ["production"],
        phases: cbDoc.phases,
      });

      const newWeights = [
        { contextId: "ctx_a", weights: [0.2, 0.8] },
        { contextId: "ctx_b", weights: [0.4, 0.6] },
      ];

      const response = await request(app)
        .put("/api/v1/experiments/exp_cb/contextual-bandit/phase/1")
        .set("Authorization", "Bearer foo")
        .send({ currentLeafWeights: newWeights });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        phase: {
          index: 1,
          dateStarted: cbDoc.phases[1].dateStarted.toISOString(),
          dateEnded: null,
          currentLeafWeights: newWeights,
        },
      });

      expect(patchPhaseWeights).toHaveBeenCalledWith("cb_1", 1, newWeights);
    });

    it("is a no-op (no patch call) when the body has no recognized fields", async () => {
      getExperimentById.mockResolvedValueOnce({
        id: "exp_cb",
        type: "contextual-bandit",
        project: "proj_a",
        environments: ["production"],
        phases: cbDoc.phases,
      });

      const response = await request(app)
        .put("/api/v1/experiments/exp_cb/contextual-bandit/phase/0")
        .set("Authorization", "Bearer foo")
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.phase.index).toBe(0);
      expect(response.body.phase.currentLeafWeights).toEqual(
        cbDoc.phases[0].currentLeafWeights,
      );
      expect(patchPhaseWeights).not.toHaveBeenCalled();
    });
  });
});
