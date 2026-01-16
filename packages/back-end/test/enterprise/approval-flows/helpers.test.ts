import { getEntityModel } from "../../../src/enterprise/approval-flows/helpers";

describe("back-end enterprise/approval-flows helpers", () => {
  describe("getEntityModel", () => {
    it("returns models for fact entities", () => {
      const context: any = {
        models: {
          factMetrics: { getById: jest.fn() },
          factTables: { getById: jest.fn() },
        },
      };

      expect(getEntityModel(context, "fact-metric")).toBe(context.models.factMetrics);
      // Test with type assertion for entity types that exist in the function but not in the type
      expect(getEntityModel(context, "fact-table" as any)).toBe(context.models.factTables);
    });

    it("returns null for unsupported entity type", () => {
      const context: any = { models: {} };
      expect(getEntityModel(context, "experiment" as any)).toBeNull();
    });
  });
});

