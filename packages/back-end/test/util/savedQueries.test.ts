import { DataVizConfig } from "shared/validators";
import { assertReadOnlySql, withVizIds } from "back-end/src/util/savedQueries";

describe("withVizIds", () => {
  it("keeps existing ids and adds missing ones", () => {
    const configs = [
      { id: "data-viz_keep", chartType: "table" },
      { chartType: "bar" },
    ] as unknown as DataVizConfig[];
    const [kept, added] = withVizIds(configs);
    expect(kept.id).toBe("data-viz_keep");
    expect(added.id).toMatch(/^data-viz_/);
  });
});

describe("assertReadOnlySql", () => {
  it("accepts SELECT and WITH queries, with or without a trailing semicolon", () => {
    expect(() => assertReadOnlySql("SELECT 1")).not.toThrow();
    expect(() => assertReadOnlySql("SELECT 1;")).not.toThrow();
    expect(() =>
      assertReadOnlySql("WITH x AS (SELECT 1 AS n) SELECT n FROM x"),
    ).not.toThrow();
  });

  it("refuses statements that write", () => {
    expect(() => assertReadOnlySql("DELETE FROM orders")).toThrow();
    expect(() =>
      assertReadOnlySql(
        "WITH changed AS (DELETE FROM orders RETURNING *) SELECT * FROM changed",
      ),
    ).toThrow();
    expect(() => assertReadOnlySql("SELECT 1; DROP TABLE orders")).toThrow();
  });
});
