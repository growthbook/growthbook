import type { ReqContext } from "back-end/types/organization";
import {
  getConfidenceLevelsForProject,
  getPValueCorrectionForProject,
  getPValueThresholdForProject,
  getSignificanceSettingsForProject,
} from "back-end/src/services/organizations";

type MockContext = Pick<ReqContext, "org" | "models" | "getProjects">;

function makeContext({
  orgSettings,
  project,
}: {
  orgSettings?: Record<string, unknown>;
  project?: {
    settings?: {
      confidenceLevel?: number;
      pValueThreshold?: number;
      pValueCorrection?: "holm-bonferroni" | "benjamini-hochberg" | null;
    };
  } | null;
}): MockContext {
  const projectDoc = project ? ({ id: "proj_1", ...project } as const) : null;
  const getProjects = jest
    .fn()
    .mockResolvedValue(projectDoc ? [projectDoc] : []);
  const getById = jest.fn().mockResolvedValue(project ?? null);
  return {
    org: {
      id: "org_1",
      settings: orgSettings ?? {},
    } as unknown as ReqContext["org"],
    getProjects,
    models: {
      projects: {
        getById,
      },
    } as unknown as ReqContext["models"],
  };
}

describe("project-aware organization helpers", () => {
  describe("getConfidenceLevelsForProject", () => {
    it("uses org setting when no projectId provided", async () => {
      const ctx = makeContext({ orgSettings: { confidenceLevel: 0.9 } });
      const res = await getConfidenceLevelsForProject(
        ctx as ReqContext,
        undefined,
      );
      expect(res.ciUpper).toBe(0.9);
    });

    it("uses project setting when provided and overrides org", async () => {
      const ctx = makeContext({
        orgSettings: { confidenceLevel: 0.9 },
        project: { settings: { confidenceLevel: 0.99 } },
      });
      const res = await getConfidenceLevelsForProject(
        ctx as ReqContext,
        "proj_1",
      );
      expect(res.ciUpper).toBe(0.99);
      expect(ctx.getProjects).toHaveBeenCalledTimes(1);
    });

    it("falls back to org when project has no override", async () => {
      const ctx = makeContext({
        orgSettings: { confidenceLevel: 0.9 },
        project: { settings: {} },
      });
      const res = await getConfidenceLevelsForProject(
        ctx as ReqContext,
        "proj_1",
      );
      expect(res.ciUpper).toBe(0.9);
      expect(ctx.getProjects).toHaveBeenCalledTimes(1);
    });

    it("falls back to default 0.95 when neither has a value", async () => {
      const ctx = makeContext({ orgSettings: {} });
      const res = await getConfidenceLevelsForProject(
        ctx as ReqContext,
        undefined,
      );
      expect(res.ciUpper).toBe(0.95);
      expect(ctx.getProjects).not.toHaveBeenCalled();
    });
  });

  describe("getPValueThresholdForProject", () => {
    it("uses org setting when no projectId provided", async () => {
      const ctx = makeContext({ orgSettings: { pValueThreshold: 0.01 } });
      const res = await getPValueThresholdForProject(
        ctx as ReqContext,
        undefined,
      );
      expect(res).toBe(0.01);
      expect(ctx.getProjects).not.toHaveBeenCalled();
    });

    it("uses project setting when provided", async () => {
      const ctx = makeContext({
        orgSettings: { pValueThreshold: 0.01 },
        project: { settings: { pValueThreshold: 0.1 } },
      });
      const res = await getPValueThresholdForProject(
        ctx as ReqContext,
        "proj_1",
      );
      expect(res).toBe(0.1);
      expect(ctx.getProjects).toHaveBeenCalledTimes(1);
    });

    it("falls back to default 0.05 when neither has a value", async () => {
      const ctx = makeContext({ orgSettings: {} });
      const res = await getPValueThresholdForProject(
        ctx as ReqContext,
        undefined,
      );
      expect(res).toBe(0.05);
      expect(ctx.getProjects).not.toHaveBeenCalled();
    });
  });

  describe("getPValueCorrectionForProject", () => {
    it("uses org setting when no projectId provided", async () => {
      const ctx = makeContext({
        orgSettings: { pValueCorrection: "holm-bonferroni" },
      });
      const res = await getPValueCorrectionForProject(
        ctx as ReqContext,
        undefined,
      );
      expect(res).toBe("holm-bonferroni");
      expect(ctx.getProjects).not.toHaveBeenCalled();
    });

    it("returns null when neither org nor project has a value", async () => {
      const ctx = makeContext({ orgSettings: {} });
      const res = await getPValueCorrectionForProject(
        ctx as ReqContext,
        undefined,
      );
      expect(res).toBeNull();
      expect(ctx.getProjects).not.toHaveBeenCalled();
    });
  });

  describe("getSignificanceSettingsForProject", () => {
    it("only hits the project models cache once for all three values", async () => {
      const ctx = makeContext({
        orgSettings: {
          confidenceLevel: 0.9,
          pValueThreshold: 0.01,
          pValueCorrection: "holm-bonferroni",
        },
        project: {
          settings: {
            confidenceLevel: 0.99,
            pValueThreshold: 0.1,
            pValueCorrection: "benjamini-hochberg",
          },
        },
      });
      const res = await getSignificanceSettingsForProject(
        ctx as ReqContext,
        "proj_1",
      );
      expect(res.ciUpper).toBe(0.99);
      expect(res.pValueThreshold).toBe(0.1);
      expect(res.pValueCorrection).toBe("benjamini-hochberg");
      expect(ctx.getProjects).toHaveBeenCalledTimes(1);
    });

    it("does not look up a project when no projectId is provided", async () => {
      const ctx = makeContext({
        orgSettings: {
          confidenceLevel: 0.9,
          pValueThreshold: 0.01,
        },
      });
      const res = await getSignificanceSettingsForProject(
        ctx as ReqContext,
        undefined,
      );
      expect(res.ciUpper).toBe(0.9);
      expect(res.pValueThreshold).toBe(0.01);
      expect(res.pValueCorrection).toBeNull();
      expect(ctx.getProjects).not.toHaveBeenCalled();
    });
  });

  it("reuses cached projects across individual helpers", async () => {
    const ctx = makeContext({
      orgSettings: {
        confidenceLevel: 0.9,
        pValueThreshold: 0.01,
      },
      project: {
        settings: {
          confidenceLevel: 0.99,
          pValueThreshold: 0.1,
        },
      },
    });

    const [confidenceLevels, pValueThreshold] = await Promise.all([
      getConfidenceLevelsForProject(ctx as ReqContext, "proj_1"),
      getPValueThresholdForProject(ctx as ReqContext, "proj_1"),
    ]);

    expect(confidenceLevels.ciUpper).toBe(0.99);
    expect(pValueThreshold).toBe(0.1);
    expect(ctx.getProjects).toHaveBeenCalledTimes(2);
  });
});
