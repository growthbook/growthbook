import request from "supertest";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { runContextualBanditSnapshot } from "back-end/src/services/contextualBandits";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));

jest.mock("back-end/src/services/contextualBandits", () => ({
  runContextualBanditSnapshot: jest.fn(),
}));

describe("POST /experiments/:id/contextual-bandit/refresh", () => {
  const { app, setReqContext } = setupApp();
  const org = { id: "org_cb" };

  beforeEach(() => {
    setReqContext({ org });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns the snapshot + cbe ids from the orchestrator", async () => {
    getExperimentById.mockResolvedValueOnce({
      id: "exp_cb",
      type: "contextual-bandit",
      phases: [{ dateStarted: new Date() }],
    });
    runContextualBanditSnapshot.mockResolvedValueOnce({
      snapshotId: "cbs_abc",
      cbeId: "cbe_def",
    });

    const response = await request(app)
      .post("/api/v1/experiments/exp_cb/contextual-bandit/refresh")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      snapshotId: "cbs_abc",
      cbeId: "cbe_def",
    });

    expect(runContextualBanditSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ org }),
      expect.objectContaining({ id: "exp_cb" }),
      0, // single phase → phase index 0
      { triggeredBy: "manual" },
    );
  });

  it("returns 400 when the experiment is missing", async () => {
    getExperimentById.mockResolvedValueOnce(null);

    const response = await request(app)
      .post("/api/v1/experiments/exp_missing/contextual-bandit/refresh")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/find experiment/i);
    expect(runContextualBanditSnapshot).not.toHaveBeenCalled();
  });

  it("rejects experiments that are not contextual bandits", async () => {
    getExperimentById.mockResolvedValueOnce({
      id: "exp_std",
      type: "multi-armed-bandit",
      phases: [{ dateStarted: new Date() }],
    });

    const response = await request(app)
      .post("/api/v1/experiments/exp_std/contextual-bandit/refresh")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/not a contextual bandit/i);
    expect(runContextualBanditSnapshot).not.toHaveBeenCalled();
  });

  it("rejects experiments with no phases", async () => {
    getExperimentById.mockResolvedValueOnce({
      id: "exp_cb_no_phase",
      type: "contextual-bandit",
      phases: [],
    });

    const response = await request(app)
      .post("/api/v1/experiments/exp_cb_no_phase/contextual-bandit/refresh")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/no phases/i);
    expect(runContextualBanditSnapshot).not.toHaveBeenCalled();
  });

  it("passes the last phase index when the experiment has multiple phases", async () => {
    getExperimentById.mockResolvedValueOnce({
      id: "exp_cb_multi",
      type: "contextual-bandit",
      phases: [{}, {}, {}],
    });
    runContextualBanditSnapshot.mockResolvedValueOnce({
      snapshotId: "cbs_xyz",
    });

    const response = await request(app)
      .post("/api/v1/experiments/exp_cb_multi/contextual-bandit/refresh")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ snapshotId: "cbs_xyz" });
    expect(runContextualBanditSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "exp_cb_multi" }),
      2,
      { triggeredBy: "manual" },
    );
  });
});
