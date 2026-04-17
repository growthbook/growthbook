import type { ReqContext } from "back-end/types/organization";
import {
  getConfidenceLevelsForOrg,
  getPValueCorrectionForOrg,
  getPValueThresholdForOrg,
  getSignificanceSettingsForOrg,
} from "back-end/src/services/organizations";

type MockContext = Pick<ReqContext, "org" | "models">;

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
  const getById = jest.fn().mockResolvedValue(project ?? null);
  return {
    org: {
      id: "org_1",
      settings: orgSettings ?? {},
    } as unknown as ReqContext["org"],
    models: {
      projects: {
        getById,
      },
    } as unknown as ReqContext["models"],
  };
}

describe("project-aware organization helpers", () => {
  describe("getConfidenceLevelsForOrg", () => {
    it("uses org setting when no projectId provided", async () => {
      const ctx = makeContext({ orgSettings: { confidenceLevel: 0.9 } });
      const res = await getConfidenceLevelsForOrg(ctx as ReqContext);
      expect(res.ciUpper).toBe(0.9);
    });

    it("uses project setting when provided and overrides org", async () => {
      const ctx = makeContext({
        orgSettings: { confidenceLevel: 0.9 },
        project: { settings: { confidenceLevel: 0.99 } },
      });
      const res = await getConfidenceLevelsForOrg(ctx as ReqContext, "proj_1");
      expect(res.ciUpper).toBe(0.99);
    });

    it("falls back to org when project has no override", async () => {
      const ctx = makeContext({
        orgSettings: { confidenceLevel: 0.9 },
        project: { settings: {} },
      });
      const res = await getConfidenceLevelsForOrg(ctx as ReqContext, "proj_1");
      expect(res.ciUpper).toBe(0.9);
    });

    it("falls back to default 0.95 when neither has a value", async () => {
      const ctx = makeContext({ orgSettings: {} });
      const res = await getConfidenceLevelsForOrg(ctx as ReqContext);
      expect(res.ciUpper).toBe(0.95);
    });
  });

  describe("getPValueThresholdForOrg", () => {
    it("uses org setting when no projectId provided", async () => {
      const ctx = makeContext({ orgSettings: { pValueThreshold: 0.01 } });
      const res = await getPValueThresholdForOrg(ctx as ReqContext);
      expect(res).toBe(0.01);
    });

    it("uses project setting when provided", async () => {
      const ctx = makeContext({
        orgSettings: { pValueThreshold: 0.01 },
        project: { settings: { pValueThreshold: 0.1 } },
      });
      const res = await getPValueThresholdForOrg(ctx as ReqContext, "proj_1");
      expect(res).toBe(0.1);
    });

    it("falls back to default 0.05 when neither has a value", async () => {
      const ctx = makeContext({ orgSettings: {} });
      const res = await getPValueThresholdForOrg(ctx as ReqContext);
      expect(res).toBe(0.05);
    });
  });

  describe("getPValueCorrectionForOrg", () => {
    it("uses org setting when no projectId provided", async () => {
      const ctx = makeContext({
        orgSettings: { pValueCorrection: "holm-bonferroni" },
      });
      const res = await getPValueCorrectionForOrg(ctx as ReqContext);
      expect(res).toBe("holm-bonferroni");
    });

    it("returns null when neither org nor project has a value", async () => {
      const ctx = makeContext({ orgSettings: {} });
      const res = await getPValueCorrectionForOrg(ctx as ReqContext);
      expect(res).toBeNull();
    });
  });

  describe("getSignificanceSettingsForOrg", () => {
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
      const res = await getSignificanceSettingsForOrg(
        ctx as ReqContext,
        "proj_1",
      );
      expect(res.ciUpper).toBe(0.99);
      expect(res.pValueThreshold).toBe(0.1);
      expect(res.pValueCorrection).toBe("benjamini-hochberg");
      expect(ctx.models.projects.getById).toHaveBeenCalledTimes(1);
    });

    it("does not look up a project when no projectId is provided", async () => {
      const ctx = makeContext({
        orgSettings: {
          confidenceLevel: 0.9,
          pValueThreshold: 0.01,
        },
      });
      const res = await getSignificanceSettingsForOrg(ctx as ReqContext);
      expect(res.ciUpper).toBe(0.9);
      expect(res.pValueThreshold).toBe(0.01);
      expect(res.pValueCorrection).toBeNull();
      expect(ctx.models.projects.getById).not.toHaveBeenCalled();
    });
  });
});
