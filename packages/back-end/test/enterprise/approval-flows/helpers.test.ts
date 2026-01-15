import { evalCondition } from "@growthbook/growthbook";
import { logger } from "back-end/src/util/logger";
import {
  adminCanBypassApprovalFlow,
  checkApprovalIsRequired,
  getApprovalFlowKey,
  getEntityModel,
  userCanReviewEntity,
} from "../../../src/enterprise/approval-flows/helpers";

jest.mock("@growthbook/growthbook", () => ({
  evalCondition: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: { error: jest.fn() },
}));

const evalConditionMock = evalCondition as jest.MockedFunction<typeof evalCondition>;
const loggerMock = logger as jest.Mocked<typeof logger>;

describe("enterprise/approval-flows helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getEntityModel", () => {
    it("returns models for fact entities", () => {
      const context: any = {
        models: {
          factMetrics: { getById: jest.fn() },
          factTables: { getById: jest.fn() },
        },
      };

      expect(getEntityModel(context, "fact-metric")).toBe(context.models.factMetrics);
      expect(getEntityModel(context, "fact-table")).toBe(context.models.factTables);
    });

    it("returns null for unsupported entity type", () => {
      const context: any = { models: {} };
      expect(getEntityModel(context, "experiment" as any)).toBeNull();
    });
  });

  describe("getApprovalFlowKey", () => {
    it("maps entity types to approval flow keys", () => {
      expect(getApprovalFlowKey("experiment")).toBe("experiments");
      expect(getApprovalFlowKey("fact-metric")).toBe("metrics");
      expect(getApprovalFlowKey("metric")).toBe("metrics");
      expect(getApprovalFlowKey("fact-table")).toBe("factTables");
    });

    it("returns null for unsupported entity type", () => {
      expect(getApprovalFlowKey("unknown" as any)).toBeNull();
    });
  });

  describe("checkApprovalIsRequired", () => {
    it("returns false when no approval flow settings exist", async () => {
      const context: any = {
        org: { settings: {} },
        models: {
          factTables: { getById: jest.fn() },
          factMetrics: { getById: jest.fn() },
        },
      };

      await expect(checkApprovalIsRequired("fact-table", "id", context)).resolves.toBe(false);
    });

    it("returns false when no setting requires review", async () => {
      const context: any = {
        org: {
          settings: {
            approvalFlow: {
              factTables: [{ requireReviewOn: false, resetReviewOnChange: false }],
            },
          },
        },
        models: {
          factTables: { getById: jest.fn() },
          factMetrics: { getById: jest.fn() },
        },
      };

      await expect(checkApprovalIsRequired("fact-table", "id", context)).resolves.toBe(false);
    });

    it("logs and returns false when model is missing", async () => {
      const context: any = {
        org: {
          settings: {
            approvalFlow: {
              experiments: [{ requireReviewOn: true, resetReviewOnChange: false }],
            },
          },
        },
        models: {},
      };

      await expect(checkApprovalIsRequired("experiment" as any, "id", context)).resolves.toBe(false);
      expect(loggerMock.error).toHaveBeenCalledWith(
        "Entity model not found for entity type: experiment"
      );
    });

    it("throws when the entity cannot be found", async () => {
      const context: any = {
        org: {
          settings: {
            approvalFlow: {
              factTables: [{ requireReviewOn: true, resetReviewOnChange: false }],
            },
          },
        },
        models: {
          factTables: { getById: jest.fn().mockResolvedValue(null) },
          factMetrics: { getById: jest.fn() },
        },
      };

      await expect(
        checkApprovalIsRequired("fact-table", "missing", context)
      ).rejects.toThrow(
        "Entity not found for entity type: fact-table and entity id: missing"
      );
    });

    it("respects officialOnly flag", async () => {
      const context: any = {
        org: {
          settings: {
            approvalFlow: {
              factTables: [
                { requireReviewOn: true, resetReviewOnChange: false, officialOnly: true },
              ],
            },
          },
        },
        models: {
          factTables: { getById: jest.fn().mockResolvedValue({ managedBy: "editor" }) },
          factMetrics: { getById: jest.fn() },
        },
      };

      await expect(checkApprovalIsRequired("fact-table", "id", context)).resolves.toBe(false);
    });

    it("returns true when condition is empty", async () => {
      const context: any = {
        org: {
          settings: {
            approvalFlow: {
              factTables: [
                {
                  requireReviewOn: true,
                  resetReviewOnChange: false,
                  condition: {},
                },
              ],
            },
          },
        },
        models: {
          factTables: { getById: jest.fn().mockResolvedValue({ managedBy: "admin" }) },
          factMetrics: { getById: jest.fn() },
        },
      };

      await expect(checkApprovalIsRequired("fact-table", "id", context)).resolves.toBe(true);
      expect(evalConditionMock).not.toHaveBeenCalled();
    });

    it("evaluates non-empty conditions", async () => {
      const context: any = {
        org: {
          settings: {
            approvalFlow: {
              factTables: [
                {
                  requireReviewOn: true,
                  resetReviewOnChange: false,
                  condition: { project: "p1" },
                },
              ],
            },
          },
        },
        models: {
          factTables: { getById: jest.fn().mockResolvedValue({ managedBy: "admin" }) },
          factMetrics: { getById: jest.fn() },
        },
      };

      evalConditionMock.mockReturnValueOnce(true);

      await expect(checkApprovalIsRequired("fact-table", "id", context)).resolves.toBe(true);
      expect(evalConditionMock).toHaveBeenCalledWith(
        { managedBy: "admin" },
        { project: "p1" }
      );
    });
  });

  describe("userCanReviewEntity", () => {
    it("returns false when settings are missing", () => {
      const context: any = { org: { settings: {} }, role: "admin" };
      expect(userCanReviewEntity("fact-table", context, {})).toBe(false);
    });

    it("returns false when user lacks required role", () => {
      const context: any = {
        org: {
          settings: {
            approvalFlow: {
              factTables: [
                {
                  approverRoles: ["analyst"],
                  requireReviewOn: true,
                  resetReviewOnChange: false,
                },
              ],
            },
          },
        },
        role: "viewer",
      };

      expect(userCanReviewEntity("fact-table", context, {})).toBe(false);
    });

    it("returns true when role is allowed and no condition is set", () => {
      const context: any = {
        org: {
          settings: {
            approvalFlow: {
              factTables: [
                {
                  approverRoles: ["admin"],
                  requireReviewOn: true,
                  resetReviewOnChange: false,
                },
              ],
            },
          },
        },
        role: "admin",
      };

      expect(userCanReviewEntity("fact-table", context, {})).toBe(true);
      expect(evalConditionMock).not.toHaveBeenCalled();
    });

    it("evaluates the condition for the entity", () => {
      const context: any = {
        org: {
          settings: {
            approvalFlow: {
              factTables: [
                {
                  approverRoles: ["admin"],
                  requireReviewOn: true,
                  resetReviewOnChange: false,
                  condition: { project: "p1" },
                },
              ],
            },
          },
        },
        role: "admin",
      };

      evalConditionMock.mockReturnValueOnce(false);
      expect(userCanReviewEntity("fact-table", context, { project: "p2" })).toBe(false);

      evalConditionMock.mockReturnValueOnce(true);
      expect(userCanReviewEntity("fact-table", context, { project: "p1" })).toBe(true);
    });
  });

  describe("adminCanBypassApprovalFlow", () => {
    it("returns false when user is not a super admin", () => {
      const approvalFlow: any = { entityType: "fact-table" };
      const context: any = { superAdmin: false, role: "admin", org: { settings: {} } };

      expect(adminCanBypassApprovalFlow(context, approvalFlow, {})).toBe(false);
    });

    it("returns false when no approval flow settings exist", () => {
      const approvalFlow: any = { entityType: "fact-table" };
      const context: any = { superAdmin: true, role: "admin", org: { settings: {} } };

      expect(adminCanBypassApprovalFlow(context, approvalFlow, {})).toBe(false);
    });

    it("allows bypass when adminCanBypass is true without conditions", () => {
      const approvalFlow: any = {
        entityType: "fact-table",
        originalEntity: { id: "ft1" },
      };
      const context: any = {
        superAdmin: true,
        role: "admin",
        org: {
          settings: {
            approvalFlow: {
              factTables: [
                { adminCanBypass: true, requireReviewOn: true, resetReviewOnChange: false },
              ],
            },
          },
        },
      };

      expect(adminCanBypassApprovalFlow(context, approvalFlow, {})).toBe(true);
    });

    it("evaluates conditions when adminCanBypass is enabled", () => {
      const approvalFlow: any = {
        entityType: "fact-table",
        originalEntity: { id: "ft1" },
      };
      const context: any = {
        superAdmin: true,
        role: "admin",
        org: {
          settings: {
            approvalFlow: {
              factTables: [
                {
                  adminCanBypass: true,
                  requireReviewOn: true,
                  resetReviewOnChange: false,
                  condition: { project: "p1" },
                },
              ],
            },
          },
        },
      };

      evalConditionMock.mockReturnValueOnce(false);
      expect(adminCanBypassApprovalFlow(context, approvalFlow, {})).toBe(false);

      evalConditionMock.mockReturnValueOnce(true);
      expect(adminCanBypassApprovalFlow(context, approvalFlow, {})).toBe(true);
    });
  });
});

