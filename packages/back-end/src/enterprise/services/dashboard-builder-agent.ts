import { z } from "zod";
import type { ReqContext } from "back-end/types/request";
import { aiTool } from "back-end/src/enterprise/services/ai";
import {
  AgentConfig,
  createAgentHandler,
} from "back-end/src/enterprise/services/agent-handler";
import {
  _buildGeneralAgentSystemPrompt as buildGeneralAgentSystemPrompt,
  buildCoreAgentTools,
  isReadOnlyAgentCall,
  sharedAgentSettings,
} from "back-end/src/agent/general-agent";
import {
  editDashboardDraft,
  getDashboardWorkingContent,
  getOrCreateDashboardDraft,
} from "back-end/src/enterprise/services/dashboardVersions";

interface BuilderParams {
  dashboardId: string;
  mode: "build" | "ask";
}

// What to build and how is the analytics skill's job; this only says where the agent is.
const builderContext = (dashboardId: string, mode: BuilderParams["mode"]) =>
  mode === "build"
    ? `
<dashboard_builder>
You are working inside GrowthBook's dashboard builder on dashboard ${dashboardId}. Your changes go to its draft, which the user sees next to this chat as you make them; viewers see nothing until the draft is published.

Load the analytics skill and follow its dashboard workflows. This dashboard already exists, so skip the step that creates one: build by adding blocks to its draft, and change it by editing that draft.
Before the first block of a build, call planDashboard once with the title and every block you intend to add.
When a reply points at a block, link it as [Show <block title>](#block-<block id>) so the user can jump to it.
Do not publish the draft. The user publishes it with the Publish button, so never say the dashboard is saved or live.
</dashboard_builder>`
    : `
<dashboard_builder>
You are working inside GrowthBook's dashboard builder on dashboard ${dashboardId}, in Ask mode. Answer questions about the user's data and about this dashboard; read it with GET /api/v2/dashboards/${dashboardId}/draft.
You cannot change anything in this mode: only reads and queries are allowed. When an answer points at a block, link it as [Show <block title>](#block-<block id>).
If the user asks for a change, say what you would change and tell them to switch to Edit.
</dashboard_builder>`;

function buildPlanTool(ctx: ReqContext, dashboardId: string) {
  return aiTool({
    description:
      "State the plan before building: the dashboard title and every block you intend to add, in display order. " +
      "Call it once, before adding the first block. It also sets the dashboard title.",
    inputSchema: z.object({
      title: z.string(),
      blocks: z.array(
        z.object({
          title: z.string(),
          kind: z
            .string()
            .describe("For example: time series, bar chart, funnel, table."),
        }),
      ),
    }),
    execute: async ({ title }) => {
      await editDashboardDraft(
        ctx,
        dashboardId,
        { op: "set-settings", settings: { title } },
        { byAI: true },
      );
      return { status: "ok" as const };
    },
  });
}

export const dashboardBuilderAgentConfig: AgentConfig<BuilderParams> = {
  ...sharedAgentSettings,
  agentType: "dashboard-builder",
  injectDatasourceHint: true,
  maxSteps: 40,

  parseParams: (body) => ({
    dashboardId: typeof body.dashboardId === "string" ? body.dashboardId : "",
    mode: body.mode === "ask" ? "ask" : "build",
  }),

  buildSystemPrompt: async (ctx, { dashboardId, mode }) => {
    // Refuses before any model call: build needs edit rights, ask needs read.
    const content =
      mode === "build"
        ? (await getOrCreateDashboardDraft(ctx, dashboardId)).content
        : await getDashboardWorkingContent(ctx, dashboardId);
    const blocks = content.blocks
      .map((b) => `- ${b.id} (${b.type}): ${b.title}`)
      .join("\n");
    return (
      buildGeneralAgentSystemPrompt(ctx) +
      "\n" +
      builderContext(dashboardId, mode) +
      `\n\nDashboard title: ${content.title}\nBlocks in the draft:\n${blocks || "(none yet)"}`
    );
  },

  buildTools: (ctx, buffer, { dashboardId, mode }, emit) => {
    const core = buildCoreAgentTools(ctx, buffer, emit);
    if (mode === "build") {
      return { ...core, planDashboard: buildPlanTool(ctx, dashboardId) };
    }
    const callApi = core.callApi.execute;
    return {
      ...core,
      callApi: {
        ...core.callApi,
        execute: (async (input, options) =>
          isReadOnlyAgentCall(input)
            ? callApi?.(input, options)
            : {
                status: "error",
                message:
                  "Ask mode cannot change anything. Tell the user to switch to Edit.",
              }) as typeof callApi,
      },
    };
  },
};

export const postDashboardBuilderChat = createAgentHandler(
  dashboardBuilderAgentConfig,
);
