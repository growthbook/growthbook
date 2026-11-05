import { assessReadiness } from "../src/readiness";
import { spec } from "./fixture";

describe("assessReadiness", () => {
  const rows = assessReadiness(spec);
  const row = (resource: string) => rows.find((r) => r.resource === resource);

  it("summarises what the generator infers", () => {
    expect(row("widget")).toEqual({
      resource: "widget",
      status: "generated",
      reasons: [],
      notes: [
        "replace on change: kind",
        "JSON: value",
        "sensitive: secret",
        "6 computed",
      ],
    });
  });

  it("explains what a resource is missing", () => {
    expect(row("gadget")?.status).toBe("needs-override");
    expect(row("gadget")?.reasons).toContain("no delete");
    expect(row("gadget")?.notes).toContain("no update: every change replaces");
  });

  it("lists unclaimed collections, skipping v1 paths that v2 replaces", () => {
    expect(
      rows
        .filter((r) => r.status === "needs-annotation")
        .map((r) => r.resource),
    ).toEqual(["/v2/things"]);
  });
});
