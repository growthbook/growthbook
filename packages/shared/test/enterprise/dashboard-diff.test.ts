/// <reference types="jest" />

import { diffDashboardContent } from "../../src/enterprise/dashboards/draftOps";
import { DashboardVersionContent } from "../../src/enterprise/validators/dashboard-version";

type Block = DashboardVersionContent["blocks"][number];

const block = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    uid: id,
    organization: "org",
    type: "markdown",
    title: id,
    description: "",
    content: "",
    layout: { x: 0, y: 0, w: 12, h: 4 },
    ...extra,
  }) as unknown as Block;

const content = (
  blocks: Block[],
  extra: Partial<DashboardVersionContent> = {},
): DashboardVersionContent => ({ title: "Board", blocks, ...extra });

describe("diffDashboardContent", () => {
  it("reports nothing for identical content", () => {
    expect(
      diffDashboardContent(content([block("a")]), content([block("a")])),
    ).toEqual([]);
  });

  it("reports added, edited, renamed, moved and removed blocks", () => {
    const before = content([block("a"), block("b"), block("c"), block("d")]);
    const after = content([
      block("a", { content: "new" }),
      block("b", { title: "B2" }),
      block("c", { layout: { x: 12, y: 0, w: 12, h: 4 } }),
      block("e"),
    ]);
    expect(diffDashboardContent(before, after)).toEqual([
      { type: "block-edited", blockId: "a", summary: 'Changed "a"' },
      { type: "block-edited", blockId: "b", summary: 'Renamed "b" to "B2"' },
      { type: "block-moved", blockId: "c", summary: 'Moved or resized "c"' },
      { type: "block-added", blockId: "e", summary: 'Added "e"' },
      { type: "block-removed", blockId: "d", summary: 'Removed "d"' },
    ]);
  });

  it("ignores a re-run that only changes result ids", () => {
    expect(
      diffDashboardContent(
        content([block("a", { explorerAnalysisId: "1" })]),
        content([block("a", { explorerAnalysisId: "2" })]),
      ),
    ).toEqual([]);
  });

  it("reports a rename of the dashboard", () => {
    expect(
      diffDashboardContent(content([]), content([], { title: "New" })),
    ).toEqual([
      { type: "settings", summary: 'Renamed the dashboard to "New"' },
    ]);
  });
});
