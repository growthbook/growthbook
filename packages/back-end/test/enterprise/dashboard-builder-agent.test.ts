import type { ReqContext } from "back-end/types/request";
import type { ConversationBuffer } from "back-end/src/enterprise/services/conversation-buffer";
import {
  builderBlockCandidate,
  dashboardBuilderAgentConfig,
} from "back-end/src/enterprise/services/dashboard-builder-agent";

const WRITE_TOOLS = [
  "planDashboard",
  "setFilters",
  "addBlock",
  "updateBlock",
  "removeBlock",
];
const tools = (mode: unknown) =>
  Object.keys(
    dashboardBuilderAgentConfig.buildTools(
      {} as ReqContext,
      {} as ConversationBuffer,
      dashboardBuilderAgentConfig.parseParams({ dashboardId: "d", mode }),
    ),
  );

describe("dashboard builder agent", () => {
  it("gives build mode the write tools and ask mode none of them", () => {
    expect(tools("build")).toEqual(expect.arrayContaining(WRITE_TOOLS));
    const ask = tools("ask");
    expect(ask).toContain("getDashboard");
    expect(ask.filter((t) => WRITE_TOOLS.includes(t))).toEqual([]);
  });

  it("defaults to build and ignores an unknown mode", () => {
    expect(dashboardBuilderAgentConfig.parseParams({}).mode).toBe("build");
    expect(dashboardBuilderAgentConfig.parseParams({ mode: "x" }).mode).toBe(
      "build",
    );
  });

  it("maps a chart config to its block type and text to markdown", () => {
    const base = { title: "T", description: "" };
    expect(
      builderBlockCandidate({
        ...base,
        config: { type: "funnel" } as never,
      }).type,
    ).toBe("funnel-exploration");
    expect(builderBlockCandidate({ ...base, markdown: "hi" })).toMatchObject({
      type: "markdown",
      content: "hi",
    });
    expect(
      builderBlockCandidate({ ...base, config: { type: "journey" } as never })
        .type,
    ).toBeUndefined();
  });
});
