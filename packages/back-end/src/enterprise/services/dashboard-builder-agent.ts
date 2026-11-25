import { z } from "zod";
import {
  apiCreateDashboardBlockInterface,
  blockLayoutInterface,
  dashboardGlobalControlsValidator,
  DashboardVersionContent,
} from "shared/enterprise";
import { explorationConfigValidator } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import { aiTool } from "back-end/src/enterprise/services/ai";
import {
  AgentConfig,
  createAgentHandler,
} from "back-end/src/enterprise/services/agent-handler";
import {
  buildProductAnalyticsSystemPrompt,
  buildProductAnalyticsTools,
} from "back-end/src/enterprise/services/product-analytics-agent";
import { runNewApiExplorationBlocks } from "back-end/src/enterprise/services/dashboards";
import {
  editDashboardDraft,
  getDashboardWorkingContent,
  getOrCreateDashboardDraft,
} from "back-end/src/enterprise/services/dashboardVersions";
import {
  fromBlockApiInterface,
  generateDashboardBlockIds,
} from "back-end/src/enterprise/models/DashboardModel";

interface BuilderParams {
  datasourceId: string;
  dashboardId: string;
  mode: "build" | "ask";
}

const BLOCK_TYPE_BY_CONFIG_TYPE: Record<string, string> = {
  metric: "metric-exploration",
  fact_table: "fact-table-exploration",
  data_source: "data-source-exploration",
  sql: "sql-exploration",
  funnel: "funnel-exploration",
};

const blockInputSchema = z.object({
  title: z.string(),
  description: z.string().describe("One line on what the block measures."),
  config: explorationConfigValidator
    .optional()
    .describe(
      "Chart block: the exploration config, the same shape runExploration takes.",
    ),
  markdown: z
    .string()
    .optional()
    .describe("Text block: markdown content. Give this instead of config."),
  layout: blockLayoutInterface
    .optional()
    .describe(
      "Position on the 24-column grid. Omit to stack below the existing blocks.",
    ),
});
type BlockInput = z.infer<typeof blockInputSchema>;

export function builderBlockCandidate({
  title,
  description,
  config,
  markdown,
  layout,
}: BlockInput) {
  return config
    ? {
        type: BLOCK_TYPE_BY_CONFIG_TYPE[config.type],
        title,
        description,
        layout,
        config,
      }
    : { type: "markdown", title, description, layout, content: markdown ?? "" };
}

// Runs the chart so a block only reaches the draft with data behind it.
async function runBlock(
  ctx: ReqContext,
  content: DashboardVersionContent,
  input: BlockInput,
) {
  const parsed = apiCreateDashboardBlockInterface.parse(
    builderBlockCandidate(input),
  );
  const [ran] = await runNewApiExplorationBlocks(ctx, [parsed], content);
  return generateDashboardBlockIds(ctx.org.id, fromBlockApiInterface(ran));
}

const describeContent = (content: DashboardVersionContent) => ({
  title: content.title,
  globalControls: content.globalControls,
  blocks: content.blocks.map((b) => ({
    id: b.id,
    type: b.type,
    title: b.title,
    description: b.description,
    layout: b.layout,
    ...("config" in b ? { config: b.config } : {}),
  })),
});

// A failed tool call goes back to the model as a result it can correct.
const safe =
  <I, O>(fn: (input: I) => Promise<O>) =>
  async (input: I) => {
    try {
      return await fn(input);
    } catch (e) {
      return {
        status: "error" as const,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  };

// Models issue tool calls in parallel; draft writes must land in call order, one at a time.
function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <I, O>(fn: (input: I) => Promise<O>) =>
    (input: I): Promise<O> => {
      const next = tail.then(() => fn(input));
      tail = next.catch(() => undefined);
      return next;
    };
}

function buildWriteTools(ctx: ReqContext, dashboardId: string) {
  const edit = (op: Parameters<typeof editDashboardDraft>[2]) =>
    editDashboardDraft(ctx, dashboardId, op, { byAI: true });
  const draftContent = async () =>
    (await getOrCreateDashboardDraft(ctx, dashboardId)).content;
  const queue = serialQueue();
  const write = <I, O>(fn: (input: I) => Promise<O>) => queue(safe(fn));

  return {
    planDashboard: aiTool({
      description:
        "State the plan before building: the dashboard title and every block you intend to add, in display order. " +
        "Call it once, before the first addBlock. It also sets the dashboard title.",
      inputSchema: z.object({
        title: z.string(),
        blocks: z.array(
          z.object({
            title: z.string(),
            kind: z
              .string()
              .describe(
                "For example: time series, bar chart, funnel, table, text.",
              ),
          }),
        ),
        filters: z
          .array(z.string())
          .optional()
          .describe(
            "Dashboard-wide filters you will set, for example Date range.",
          ),
      }),
      execute: write(async ({ title }) => {
        await edit({ op: "set-settings", settings: { title } });
        return { status: "ok" as const };
      }),
    }),

    setFilters: aiTool({
      description:
        "Set the dashboard-wide controls, such as the shared date range and granularity. " +
        "Call it before adding blocks: blocks added afterwards are run with these controls applied.",
      inputSchema: z.object({
        globalControls: dashboardGlobalControlsValidator,
      }),
      execute: write(async ({ globalControls }) => {
        await edit({ op: "set-settings", settings: { globalControls } });
        return { status: "ok" as const };
      }),
    }),

    addBlock: aiTool({
      description:
        "Add one block to the end of the dashboard draft. A chart block is run against the warehouse first, so this waits for the query. " +
        "Returns the new block's id.",
      inputSchema: blockInputSchema,
      execute: write(async (input) => {
        const block = await runBlock(ctx, await draftContent(), input);
        await edit({ op: "add-block", block });
        return {
          status: "ok" as const,
          blockId: block.id,
          type: block.type,
          title: block.title,
        };
      }),
    }),

    updateBlock: aiTool({
      description:
        "Replace an existing block in the draft, keeping its id and, unless you pass a layout, its position. " +
        "Send the full block, not only the fields that changed. Get block ids from getDashboard.",
      inputSchema: blockInputSchema.extend({ blockId: z.string() }),
      execute: write(async ({ blockId, ...input }) => {
        const content = await draftContent();
        const existing = content.blocks.find((b) => b.id === blockId);
        if (!existing) throw new Error("Block not found in the draft");
        const block = await runBlock(ctx, content, {
          ...input,
          layout: input.layout ?? existing.layout,
        });
        await edit({
          op: "update-block",
          block: { ...block, id: existing.id, uid: existing.uid },
        });
        return { status: "ok" as const, blockId, title: block.title };
      }),
    }),

    removeBlock: aiTool({
      description: "Remove a block from the draft by id.",
      inputSchema: z.object({ blockId: z.string() }),
      execute: write(async ({ blockId }) => {
        await edit({ op: "remove-block", blockId });
        return { status: "ok" as const, blockId };
      }),
    }),
  };
}

const BUILD_INSTRUCTIONS = `
<dashboard_builder>
You are working inside GrowthBook's dashboard builder. The user sees the dashboard next to this chat and watches each block appear as you add it.

When asked to build a dashboard:
1. Find the metrics and fact tables you need with search and getAvailableColumns. Verify filter values with getColumnValues.
2. Call planDashboard once with the title and every block you intend to add.
3. If the blocks should share a date range, call setFilters before adding any block.
4. Call addBlock once per block, in display order. Blocks are added one at a time in the order you call it. Do not call runExploration to preview a block you are about to add: addBlock runs it.
5. Finish with one or two sentences on what you built and anything notable. Do not list every block.

When asked to change the dashboard, call getDashboard for the current block ids, then use updateBlock, removeBlock, addBlock or setFilters.

Layout: the grid is 24 columns wide. A full-width block has w=24; two blocks side by side have w=12 at x=0 and x=12. Omit layout to stack a block below the rest.
Everything you change goes into a draft. Nothing is published until the user publishes it, so never say the dashboard is saved or live.
If addBlock fails, fix the config and retry that block; if it keeps failing, skip it and say so at the end.
</dashboard_builder>`;

const ASK_INSTRUCTIONS = `
<dashboard_builder>
You are working inside GrowthBook's dashboard builder in Ask mode. Answer questions about the user's data and about this dashboard; call getDashboard to see its blocks.
You cannot change the dashboard in this mode. If the user asks for a change, say what you would change and tell them to switch to Edit.
</dashboard_builder>`;

export const dashboardBuilderAgentConfig: AgentConfig<BuilderParams> = {
  agentType: "dashboard-builder",
  // ponytail: shares the explorer's prompt type; split it when orgs need a separate custom prompt.
  promptType: "product-analytics-chat",

  parseParams: (body) => ({
    datasourceId:
      typeof body.datasourceId === "string" ? body.datasourceId : "",
    dashboardId: typeof body.dashboardId === "string" ? body.dashboardId : "",
    mode: body.mode === "ask" ? "ask" : "build",
  }),

  buildSystemPrompt: async (ctx, { datasourceId, dashboardId, mode }) => {
    // Build mode needs edit rights; this also refuses before any model call.
    const content =
      mode === "build"
        ? (await getOrCreateDashboardDraft(ctx, dashboardId)).content
        : await getDashboardWorkingContent(ctx, dashboardId);
    const blocks = content.blocks
      .map((b) => `- ${b.id} (${b.type}): ${b.title}`)
      .join("\n");
    return (
      (await buildProductAnalyticsSystemPrompt(ctx, datasourceId)) +
      "\n" +
      (mode === "build" ? BUILD_INSTRUCTIONS : ASK_INSTRUCTIONS) +
      `\n\nDashboard title: ${content.title}\nBlocks:\n${blocks || "(none yet)"}`
    );
  },

  buildTools: (ctx, buffer, { datasourceId, dashboardId, mode }) => ({
    ...buildProductAnalyticsTools(ctx, buffer, datasourceId),
    getDashboard: aiTool({
      description:
        "Read the dashboard as it stands: title, dashboard-wide controls and every block with its id, type and config.",
      inputSchema: z.object({}),
      execute: safe(async () =>
        describeContent(await getDashboardWorkingContent(ctx, dashboardId)),
      ),
    }),
    ...(mode === "build" ? buildWriteTools(ctx, dashboardId) : {}),
  }),

  temperature: 0.1,
  maxSteps: 40,
  maxConsecutiveToolErrors: 5,
};

export const postDashboardBuilderChat = createAgentHandler(
  dashboardBuilderAgentConfig,
);
