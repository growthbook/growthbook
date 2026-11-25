import {
  applyDashboardDraftOp,
  DashboardBlockInterface,
  DashboardVersionContent,
} from "../src/enterprise";

const block = (id: string, content = id): DashboardBlockInterface => ({
  organization: "org",
  id,
  uid: id,
  type: "markdown",
  title: id,
  description: "",
  content,
});
const ids = (c: DashboardVersionContent) => c.blocks.map((b) => b.id);
const base: DashboardVersionContent = {
  title: "T",
  blocks: [block("a"), block("b")],
};

describe("applyDashboardDraftOp", () => {
  it("adds a block at the end or at an index", () => {
    expect(
      ids(applyDashboardDraftOp(base, { op: "add-block", block: block("c") })),
    ).toEqual(["a", "b", "c"]);
    expect(
      ids(
        applyDashboardDraftOp(base, {
          op: "add-block",
          block: block("c"),
          index: 0,
        }),
      ),
    ).toEqual(["c", "a", "b"]);
  });

  it("updates and removes by id without touching the input", () => {
    const updated = applyDashboardDraftOp(base, {
      op: "update-block",
      block: block("b", "new"),
    });
    expect(updated.blocks[1]).toMatchObject({ id: "b", content: "new" });
    expect(
      ids(applyDashboardDraftOp(base, { op: "remove-block", blockId: "a" })),
    ).toEqual(["b"]);
    expect(base.blocks[1]).toMatchObject({ content: "b" });
    expect(ids(base)).toEqual(["a", "b"]);
  });

  it("changes settings and keeps the blocks", () => {
    const next = applyDashboardDraftOp(base, {
      op: "set-settings",
      settings: { title: "New" },
    });
    expect(next.title).toBe("New");
    expect(ids(next)).toEqual(["a", "b"]);
  });

  it("rejects a duplicate add and an unknown block", () => {
    expect(() =>
      applyDashboardDraftOp(base, { op: "add-block", block: block("a") }),
    ).toThrow("already exists");
    expect(() =>
      applyDashboardDraftOp(base, { op: "remove-block", blockId: "z" }),
    ).toThrow("not found");
  });
});
