import {
  HierarchicalModification,
  HierarchicalValue,
} from "shared/types/events/diff";
import { getObjectDiff } from "back-end/src/events/handlers/webhooks/event-webhooks-utils";

describe("getObjectDiff", () => {
  describe("basic diff operations", () => {
    it("detects added keys", () => {
      const prev = { a: 1 };
      const curr = { a: 1, b: 2 };
      const result = getObjectDiff(prev, curr);

      expect(result.added).toEqual({ b: 2 });
      expect(result.removed).toEqual({});
      expect(result.modified).toEqual([]);
    });

    it("detects removed keys", () => {
      const prev = { a: 1, b: 2 };
      const curr = { a: 1 };
      const result = getObjectDiff(prev, curr);

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({ b: 2 });
      expect(result.modified).toEqual([]);
    });

    it("detects modified keys", () => {
      const prev = { a: 1, b: 2 };
      const curr = { a: 1, b: 3 };
      const result = getObjectDiff(prev, curr);

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toEqual([{ key: "b", oldValue: 2, newValue: 3 }]);
    });

    it("returns empty diff for identical objects", () => {
      const prev = { a: 1, b: 2 };
      const curr = { a: 1, b: 2 };
      const result = getObjectDiff(prev, curr);

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toEqual([]);
    });
  });

  describe("ignoredKeys option", () => {
    it("ignores specified keys when detecting changes", () => {
      const prev = { a: 1, b: 2, c: 3 };
      const curr = { a: 1, b: 5, c: 6 };
      const result = getObjectDiff(prev, curr, {
        ignoredKeys: ["c"],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toEqual([{ key: "b", oldValue: 2, newValue: 5 }]);
    });

    it("ignores specified keys when detecting additions", () => {
      const prev = { a: 1 };
      const curr = { a: 1, b: 2, c: 3 };
      const result = getObjectDiff(prev, curr, {
        ignoredKeys: ["c"],
      });

      expect(result.added).toEqual({ b: 2 });
      expect(result.removed).toEqual({});
      expect(result.modified).toEqual([]);
    });

    it("ignores specified keys when detecting removals", () => {
      const prev = { a: 1, b: 2, c: 3 };
      const curr = { a: 1 };
      const result = getObjectDiff(prev, curr, {
        ignoredKeys: ["c"],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({ b: 2 });
      expect(result.modified).toEqual([]);
    });
  });

  describe("top-level arrays with nestedObjectConfig", () => {
    it("detects changes in top-level arrays with idField", () => {
      const prev = {
        variations: [
          { variationId: "v0", name: "Control", value: 1 },
          { variationId: "v1", name: "Variation", value: 2 },
        ],
      };
      const curr = {
        variations: [
          { variationId: "v0", name: "Control Updated", value: 1 },
          { variationId: "v1", name: "Variation", value: 2 },
        ],
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "variations",
            idField: "variationId",
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);
      expect(result.modified[0].key).toBe("variations");

      const modification = result.modified[0] as HierarchicalModification;
      expect(modification.values).toHaveLength(1);
      expect(modification.values[0].changes!.modified).toHaveLength(1);
      expect(modification.values[0].changes!.modified![0].id).toBe("v0");
      expect(modification.values[0].changes!.modified![0].fieldChanges).toEqual(
        [{ field: "name", oldValue: "Control", newValue: "Control Updated" }],
      );
    });

    it("ignores specified fields in top-level array items", () => {
      const prev = {
        variations: [
          {
            variationId: "v0",
            name: "Control",
            screenshots: ["url1.png"],
          },
          {
            variationId: "v1",
            name: "Variation",
            screenshots: ["url2.png"],
          },
        ],
      };
      const curr = {
        variations: [
          {
            variationId: "v0",
            name: "Control",
            screenshots: ["url_changed.png"],
          },
          {
            variationId: "v1",
            name: "Variation",
            screenshots: ["url2_changed.png"],
          },
        ],
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "variations",
            idField: "variationId",
            ignoredKeys: ["screenshots"],
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toEqual([]);
    });

    it("detects changes when non-ignored fields change, even if ignored fields also change", () => {
      const prev = {
        variations: [
          {
            variationId: "v0",
            name: "Control",
            screenshots: ["url1.png"],
          },
        ],
      };
      const curr = {
        variations: [
          {
            variationId: "v0",
            name: "Control Updated",
            screenshots: ["url_changed.png"],
          },
        ],
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "variations",
            idField: "variationId",
            ignoredKeys: ["screenshots"],
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const modification = result.modified[0] as HierarchicalModification;
      expect(modification.key).toBe("variations");
      expect(modification.values[0].changes!.modified).toHaveLength(1);
      expect(modification.values[0].changes!.modified![0].fieldChanges).toEqual(
        [{ field: "name", oldValue: "Control", newValue: "Control Updated" }],
      );
    });

    it("detects added items in top-level arrays", () => {
      const prev = {
        variations: [{ variationId: "v0", name: "Control" }],
      };
      const curr = {
        variations: [
          { variationId: "v0", name: "Control" },
          { variationId: "v1", name: "Variation" },
        ],
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "variations",
            idField: "variationId",
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const modification = result.modified[0] as HierarchicalModification;
      expect(modification.key).toBe("variations");
      expect(modification.values[0].changes!.added).toHaveLength(1);
      expect(modification.values[0].changes!.added![0]).toMatchObject({
        variationId: "v1",
        name: "Variation",
      });
    });

    it("detects removed items in top-level arrays", () => {
      const prev = {
        variations: [
          { variationId: "v0", name: "Control" },
          { variationId: "v1", name: "Variation" },
        ],
      };
      const curr = {
        variations: [{ variationId: "v0", name: "Control" }],
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "variations",
            idField: "variationId",
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const modification = result.modified[0] as HierarchicalModification;
      expect(modification.key).toBe("variations");
      expect(modification.values[0].changes!.removed).toHaveLength(1);
      expect(modification.values[0].changes!.removed![0]).toMatchObject({
        variationId: "v1",
        name: "Variation",
      });
    });

    it("handles multiple variations with mixed changes and ignored fields", () => {
      const prev = {
        variations: [
          {
            variationId: "v0",
            name: "Control",
            description: "Original",
            screenshots: ["https://example.com/old1.png"],
          },
          {
            variationId: "v1",
            name: "Variation A",
            description: "Test A",
            screenshots: ["https://example.com/old2.png"],
          },
          {
            variationId: "v2",
            name: "Variation B",
            description: "Test B",
            screenshots: ["https://example.com/old3.png"],
          },
        ],
      };
      const curr = {
        variations: [
          {
            variationId: "v0",
            name: "Control",
            description: "Original",
            screenshots: ["https://example.com/new1.png"],
          },
          {
            variationId: "v1",
            name: "Variation A Updated",
            description: "Test A",
            screenshots: ["https://example.com/new2.png"],
          },
          {
            variationId: "v2",
            name: "Variation B",
            description: "Test B",
            screenshots: ["https://example.com/new3.png"],
          },
        ],
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "variations",
            idField: "variationId",
            ignoredKeys: ["screenshots"],
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const modification = result.modified[0] as HierarchicalModification;
      expect(modification.key).toBe("variations");
      expect(modification.values[0].changes!.modified).toHaveLength(1);
      expect(modification.values[0].changes!.modified![0].id).toBe("v1");
      expect(modification.values[0].changes!.modified![0].fieldChanges).toEqual(
        [
          {
            field: "name",
            oldValue: "Variation A",
            newValue: "Variation A Updated",
          },
        ],
      );
    });

    it("returns no changes when only ignored fields differ in all variations", () => {
      const prev = {
        variations: [
          {
            variationId: "v0",
            name: "Control",
            screenshots: [
              "https://growthbook-dev-test.s3.amazonaws.com/image1.png?X-Amz-Credential=ASIAW57C2GK7GSXZVZN2",
            ],
          },
          {
            variationId: "v1",
            name: "Variation",
            screenshots: [
              "https://growthbook-dev-test.s3.amazonaws.com/image2.png?X-Amz-Credential=ASIAW57C2GK7JA5KR324",
            ],
          },
        ],
      };
      const curr = {
        variations: [
          {
            variationId: "v0",
            name: "Control",
            screenshots: [
              "https://growthbook-dev-test.s3.amazonaws.com/image1.png?X-Amz-Credential=ASIAW57C2GK7OWIZYWUD",
            ],
          },
          {
            variationId: "v1",
            name: "Variation",
            screenshots: [
              "https://growthbook-dev-test.s3.amazonaws.com/image2.png?X-Amz-Credential=ASIAW57C2GK7PU6JRYDD",
            ],
          },
        ],
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "variations",
            idField: "variationId",
            ignoredKeys: ["screenshots"],
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toEqual([]);
    });
  });

  describe("arrays without nestedObjectConfig", () => {
    it("treats arrays as simple values when no config provided", () => {
      const prev = {
        items: [1, 2, 3],
      };
      const curr = {
        items: [1, 2, 4],
      };

      const result = getObjectDiff(prev, curr);

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toEqual([
        { key: "items", oldValue: [1, 2, 3], newValue: [1, 2, 4] },
      ]);
    });

    it("returns no changes for identical arrays", () => {
      const prev = {
        items: [1, 2, 3],
      };
      const curr = {
        items: [1, 2, 3],
      };

      const result = getObjectDiff(prev, curr);

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toEqual([]);
    });
  });

  describe("complex nested scenarios", () => {
    it("handles multiple top-level arrays with different configs", () => {
      const prev = {
        variations: [
          {
            variationId: "v0",
            name: "Control",
            screenshots: ["url1.png"],
          },
        ],
        phases: [
          {
            phaseId: "p0",
            name: "Phase 1",
            dateStarted: "2024-01-01",
          },
        ],
      };
      const curr = {
        variations: [
          {
            variationId: "v0",
            name: "Control Updated",
            screenshots: ["url_changed.png"],
          },
        ],
        phases: [
          {
            phaseId: "p0",
            name: "Phase 1",
            dateStarted: "2024-01-02",
          },
        ],
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "variations",
            idField: "variationId",
            ignoredKeys: ["screenshots"],
          },
          {
            key: "phases",
            idField: "phaseId",
            ignoredKeys: ["dateStarted"],
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const modification = result.modified[0] as HierarchicalModification;
      expect(modification.key).toBe("variations");
      expect(modification.values[0].changes!.modified).toHaveLength(1);
      expect(modification.values[0].changes!.modified![0].fieldChanges).toEqual(
        [{ field: "name", oldValue: "Control", newValue: "Control Updated" }],
      );
    });

    it("combines top-level changes with array changes", () => {
      const prev = {
        name: "Experiment A",
        variations: [
          { variationId: "v0", name: "Control", screenshots: ["url1.png"] },
        ],
      };
      const curr = {
        name: "Experiment B",
        variations: [
          { variationId: "v0", name: "Control", screenshots: ["url2.png"] },
        ],
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "variations",
            idField: "variationId",
            ignoredKeys: ["screenshots"],
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);
      expect(result.modified[0]).toEqual({
        key: "name",
        oldValue: "Experiment A",
        newValue: "Experiment B",
      });
    });
  });

  describe("nested arrays with reordering (container pattern)", () => {
    it("detects reordering of nested array items", () => {
      const prev = {
        environments: {
          production: {
            id: "production",
            rules: [
              { ruleId: "rule1", value: "a" },
              { ruleId: "rule2", value: "b" },
              { ruleId: "rule3", value: "c" },
            ],
          },
        },
      };
      const curr = {
        environments: {
          production: {
            id: "production",
            rules: [
              { ruleId: "rule3", value: "c" },
              { ruleId: "rule1", value: "a" },
              { ruleId: "rule2", value: "b" },
            ],
          },
        },
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "environments",
            idField: "ruleId",
            arrayField: "rules",
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const envMod = result.modified[0] as HierarchicalModification;
      expect(envMod.key).toBe("environments");
      expect(envMod.values).toHaveLength(1);
      expect(envMod.values[0].key).toBe("production");
      expect(envMod.values[0].values).toHaveLength(1);

      const rulesMod = envMod.values[0].values![0] as HierarchicalValue;
      expect(rulesMod.key).toBe("rules");
      expect(rulesMod.changes!.orderSummaries).toBeDefined();
      expect(rulesMod.changes!.orderSummaries).toHaveLength(1);
      expect(rulesMod.changes!.orderSummaries![0]).toMatchObject({
        type: "reorderShift",
        movedId: "rule3",
        fromIndex: 2,
        toIndex: 0,
        direction: "up",
      });
    });

    it("detects changes in nested array items", () => {
      const prev = {
        environments: {
          production: {
            id: "production",
            rules: [
              { ruleId: "rule1", value: "a", enabled: true },
              { ruleId: "rule2", value: "b", enabled: false },
            ],
          },
        },
      };
      const curr = {
        environments: {
          production: {
            id: "production",
            rules: [
              { ruleId: "rule1", value: "a", enabled: true },
              { ruleId: "rule2", value: "b-updated", enabled: true },
            ],
          },
        },
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "environments",
            idField: "ruleId",
            arrayField: "rules",
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const envMod = result.modified[0] as HierarchicalModification;
      expect(envMod.values[0].values).toHaveLength(1);

      const rulesMod = envMod.values[0].values![0] as HierarchicalValue;
      expect(rulesMod.key).toBe("rules");
      expect(rulesMod.changes!.modified).toHaveLength(1);
      expect(rulesMod.changes!.modified![0].id).toBe("rule2");
      expect(rulesMod.changes!.modified![0].fieldChanges).toEqual([
        { field: "value", oldValue: "b", newValue: "b-updated" },
        { field: "enabled", oldValue: false, newValue: true },
      ]);
    });

    it("detects added items in nested arrays", () => {
      const prev = {
        environments: {
          production: {
            id: "production",
            rules: [{ ruleId: "rule1", value: "a" }],
          },
        },
      };
      const curr = {
        environments: {
          production: {
            id: "production",
            rules: [
              { ruleId: "rule1", value: "a" },
              { ruleId: "rule2", value: "b" },
            ],
          },
        },
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "environments",
            idField: "ruleId",
            arrayField: "rules",
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const envMod = result.modified[0] as HierarchicalModification;
      expect(envMod.values[0].values).toHaveLength(1);

      const rulesMod = envMod.values[0].values![0] as HierarchicalValue;
      expect(rulesMod.key).toBe("rules");
      expect(rulesMod.changes!.added).toEqual([
        { ruleId: "rule2", value: "b", __index: 1 },
      ]);
    });

    it("detects removed items in nested arrays", () => {
      const prev = {
        environments: {
          production: {
            id: "production",
            rules: [
              { ruleId: "rule1", value: "a" },
              { ruleId: "rule2", value: "b" },
            ],
          },
        },
      };
      const curr = {
        environments: {
          production: {
            id: "production",
            rules: [{ ruleId: "rule1", value: "a" }],
          },
        },
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "environments",
            idField: "ruleId",
            arrayField: "rules",
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const envMod = result.modified[0] as HierarchicalModification;
      expect(envMod.values[0].values).toHaveLength(1);

      const rulesMod = envMod.values[0].values![0] as HierarchicalValue;
      expect(rulesMod.key).toBe("rules");
      expect(rulesMod.changes!.removed).toEqual([
        { ruleId: "rule2", value: "b", __index: 1 },
      ]);
    });

    it("ignores specified keys in nested arrays", () => {
      const prev = {
        environments: {
          production: {
            id: "production",
            rules: [{ ruleId: "rule1", value: "a", timestamp: "2024-01-01" }],
          },
        },
      };
      const curr = {
        environments: {
          production: {
            id: "production",
            rules: [{ ruleId: "rule1", value: "a", timestamp: "2024-01-02" }],
          },
        },
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "environments",
            idField: "ruleId",
            arrayField: "rules",
            ignoredKeys: ["timestamp"],
          },
        ],
      });

      // When ignoredKeys filters out all changes, the container may still appear
      // but with no actual modifications in the nested values
      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      // The result should either be empty or have an environments modification with no actual changes
      if (result.modified.length > 0) {
        const envMod = result.modified[0] as HierarchicalModification;
        expect(envMod.key).toBe("environments");
        // There should be no nested values since all changes were ignored
        expect(envMod.values[0].values || []).toEqual([]);
      }
    });

    it("handles multiple environments with nested arrays", () => {
      const prev = {
        environments: {
          production: {
            id: "production",
            rules: [{ ruleId: "rule1", value: "a" }],
          },
          staging: {
            id: "staging",
            rules: [{ ruleId: "rule2", value: "b" }],
          },
        },
      };
      const curr = {
        environments: {
          production: {
            id: "production",
            rules: [{ ruleId: "rule1", value: "a-updated" }],
          },
          staging: {
            id: "staging",
            rules: [{ ruleId: "rule2", value: "b" }],
          },
        },
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "environments",
            idField: "ruleId",
            arrayField: "rules",
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const envMod = result.modified[0] as HierarchicalModification;
      expect(envMod.values).toHaveLength(1);
      expect(envMod.values[0].key).toBe("production");
      expect(envMod.values[0].values).toHaveLength(1);

      const rulesMod = envMod.values[0].values![0] as HierarchicalValue;
      expect(rulesMod.key).toBe("rules");
      expect(rulesMod.changes!.modified).toHaveLength(1);
      expect(rulesMod.changes!.modified![0].fieldChanges).toEqual([
        { field: "value", oldValue: "a", newValue: "a-updated" },
      ]);
    });

    it("handles combined changes in nested arrays (add, modify, reorder)", () => {
      const prev = {
        environments: {
          production: {
            id: "production",
            rules: [
              { ruleId: "rule1", value: "a" },
              { ruleId: "rule2", value: "b" },
            ],
          },
        },
      };
      const curr = {
        environments: {
          production: {
            id: "production",
            rules: [
              { ruleId: "rule2", value: "b-updated" },
              { ruleId: "rule3", value: "c" },
              { ruleId: "rule1", value: "a" },
            ],
          },
        },
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "environments",
            idField: "ruleId",
            arrayField: "rules",
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const envMod = result.modified[0] as HierarchicalModification;
      expect(envMod.values[0].values).toHaveLength(1);

      const rulesMod = envMod.values[0].values![0] as HierarchicalValue;
      expect(rulesMod.key).toBe("rules");

      // Should detect added item
      expect(rulesMod.changes!.added).toHaveLength(1);
      expect(rulesMod.changes!.added![0]).toMatchObject({
        ruleId: "rule3",
        value: "c",
      });

      // Should detect modified item with value change
      const modifiedItem = rulesMod.changes!.modified!.find(
        (m) => m.id === "rule2",
      );
      expect(modifiedItem).toBeDefined();
      expect(modifiedItem!.fieldChanges).toEqual([
        { field: "value", oldValue: "b", newValue: "b-updated" },
      ]);

      // Should detect reordering - shown as oldIndex/newIndex/steps in modified items
      expect(modifiedItem!.oldIndex).toBeDefined();
      expect(modifiedItem!.newIndex).toBeDefined();
      expect(modifiedItem!.steps).toBeDefined();

      // rule1 should also show reordering (even without value change)
      const reorderedItem = rulesMod.changes!.modified!.find(
        (m) => m.id === "rule1",
      );
      expect(reorderedItem).toBeDefined();
      expect(reorderedItem!.oldIndex).toBe(0);
      expect(reorderedItem!.newIndex).toBe(2);
    });

    it("handles changes at both container and nested array levels", () => {
      const prev = {
        environments: {
          production: {
            id: "production",
            name: "Production",
            rules: [{ ruleId: "rule1", value: "a" }],
          },
        },
      };
      const curr = {
        environments: {
          production: {
            id: "production",
            name: "Production Updated",
            rules: [{ ruleId: "rule1", value: "a-updated" }],
          },
        },
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "environments",
            idField: "ruleId",
            arrayField: "rules",
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const envMod = result.modified[0] as HierarchicalModification;
      expect(envMod.values[0].key).toBe("production");
      expect(envMod.values[0].values).toHaveLength(1);

      // Should have modified name field at container level
      const containerMods = envMod.values[0].modified!;
      const nameModification = containerMods.find(
        (m) => "key" in m && m.key === "name",
      );
      expect(nameModification).toEqual({
        key: "name",
        oldValue: "Production",
        newValue: "Production Updated",
      });

      // Should have modified rules array
      const rulesMod = envMod.values[0].values![0] as HierarchicalValue;
      expect(rulesMod.key).toBe("rules");
      expect(rulesMod.changes!.modified).toHaveLength(1);
      expect(rulesMod.changes!.modified![0].fieldChanges).toEqual([
        { field: "value", oldValue: "a", newValue: "a-updated" },
      ]);
    });
  });

  describe("edge cases and special scenarios", () => {
    it("handles empty arrays", () => {
      const prev = {
        variations: [],
      };
      const curr = {
        variations: [],
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "variations",
            idField: "variationId",
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toEqual([]);
    });

    it("handles transition from empty to non-empty array", () => {
      const prev = {
        variations: [],
      };
      const curr = {
        variations: [{ variationId: "v0", name: "Control" }],
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "variations",
            idField: "variationId",
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const modification = result.modified[0] as HierarchicalModification;
      expect(modification.values[0].changes!.added).toHaveLength(1);
    });

    it("handles transition from non-empty to empty array", () => {
      const prev = {
        variations: [{ variationId: "v0", name: "Control" }],
      };
      const curr = {
        variations: [],
      };

      const result = getObjectDiff(prev, curr, {
        nestedObjectConfigs: [
          {
            key: "variations",
            idField: "variationId",
          },
        ],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toHaveLength(1);

      const modification = result.modified[0] as HierarchicalModification;
      expect(modification.values[0].changes!.removed).toHaveLength(1);
    });

    it("handles null and undefined values", () => {
      const prev = {
        a: null,
        b: undefined,
        c: "value",
      };
      const curr = {
        a: "value",
        b: null,
        c: undefined,
      };

      const result = getObjectDiff(prev, curr);

      expect(result.modified).toEqual([
        { key: "a", oldValue: null, newValue: "value" },
        { key: "b", oldValue: undefined, newValue: null },
        { key: "c", oldValue: "value", newValue: undefined },
      ]);
    });

    it("handles deeply nested objects without config", () => {
      const prev = {
        config: {
          nested: {
            deep: {
              value: 1,
            },
          },
        },
      };
      const curr = {
        config: {
          nested: {
            deep: {
              value: 2,
            },
          },
        },
      };

      const result = getObjectDiff(prev, curr);

      expect(result.modified).toHaveLength(1);
      expect(result.modified[0].key).toBe("config");
    });

    it("handles objects with all keys ignored", () => {
      const prev = { a: 1, b: 2, c: 3 };
      const curr = { a: 10, b: 20, c: 30 };

      const result = getObjectDiff(prev, curr, {
        ignoredKeys: ["a", "b", "c"],
      });

      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
      expect(result.modified).toEqual([]);
    });
  });
});
