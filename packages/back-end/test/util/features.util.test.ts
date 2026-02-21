import { applyEnvironmentInheritance } from "../../src/util/features";

describe("feature utils", () => {
  describe("applyEnvironmentInheritance", () => {
    it("inherits the values of parent environments", () => {
      const envRecord = {
        parent: "value",
      };
      const result = applyEnvironmentInheritance(
        [
          { id: "parent", description: "" },
          { id: "child", parent: "parent", description: "" },
        ],
        envRecord,
      );
      expect(result).toEqual({
        parent: "value",
        child: "value",
      });
    });

    it("handles recursive inheritance", () => {
      const envRecord = {
        grandparent: "value",
      };
      const result = applyEnvironmentInheritance(
        [
          { id: "grandparent", description: "" },
          { id: "parent", description: "", parent: "grandparent" },
          { id: "child", parent: "parent", description: "" },
        ],
        envRecord,
      );
      expect(result).toEqual({
        grandparent: "value",
        parent: "value",
        child: "value",
      });
    });

    it("does not mutate the argument", () => {
      const envRecord = {
        parent: "value",
        child: undefined,
      };
      applyEnvironmentInheritance(
        [
          { id: "parent", description: "" },
          { id: "child", parent: "parent", description: "" },
        ],
        envRecord,
      );
      expect(envRecord.child).toBeUndefined();
    });

    it("copies values rather than references", () => {
      const envRecord = {
        parent: ["nested object"],
      };
      const result = applyEnvironmentInheritance(
        [
          { id: "parent", description: "" },
          { id: "child", parent: "parent", description: "" },
        ],
        envRecord,
      );
      result.child.push("new entry");
      expect(result).toEqual({
        parent: ["nested object"],
        child: ["nested object", "new entry"],
      });
    });

    it("handles undefined environmentRecord with parent environments", () => {
      const result = applyEnvironmentInheritance(
        [
          { id: "parent", description: "" },
          { id: "child", parent: "parent", description: "" },
        ],
        undefined as unknown as Record<string, unknown>,
      );
      expect(result).toEqual({});
    });

    it("handles empty environmentRecord with parent environments", () => {
      const result = applyEnvironmentInheritance(
        [
          { id: "dev", description: "" },
          { id: "staging", parent: "dev", description: "" },
          { id: "production", parent: "staging", description: "" },
        ],
        {},
      );
      expect(result).toEqual({});
    });
  });
});
