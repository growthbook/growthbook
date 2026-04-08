import { streamText, tool, ModelMessage, stepCountIs } from "ai";
import { z } from "zod";
import { ReqContext } from "back-end/types/request";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { getAIProviderClass } from "back-end/src/enterprise/services/ai";
import {
  getAllExperiments,
  getExperimentById,
} from "back-end/src/models/ExperimentModel";
import {
  getAllFeatures,
  getFeature,
  toggleFeatureEnvironment,
} from "back-end/src/models/FeatureModel";
import { getMetricsByOrganization } from "back-end/src/models/MetricModel";
import { getEnvironments } from "back-end/src/util/organization.util";
import {
  addMessages,
  getMessages,
  updateConversationTimestamp,
} from "back-end/src/models/AIChatModel";
import { updateTokenUsage } from "back-end/src/models/AITokenUsageModel";
import {
  IS_CLOUD,
  KAPA_AI_API_KEY,
  KAPA_AI_MCP_URL,
} from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { fetch } from "back-end/src/util/http.util";

function getSystemPrompt(
  context: ReqContext,
  currentPage?: string,
  customContext?: string,
): string {
  const orgName = context.org.name || "your organization";
  const userName = context.userName || context.email || "the user";

  let pageContext = "";
  if (currentPage) {
    pageContext = `\nThe user is currently viewing: ${currentPage}`;
    // Extract entity references from the URL so the AI knows what's in scope
    const experimentMatch = currentPage.match(/\/experiment\/([^/?#]+)/);
    const featureMatch = currentPage.match(/\/features\/([^/?#]+)/);
    const metricMatch = currentPage.match(/\/metric\/([^/?#]+)/);
    const factMetricMatch = currentPage.match(/\/fact-metrics\/([^/?#]+)/);
    if (experimentMatch) {
      pageContext += `\nThey are looking at experiment ID: ${experimentMatch[1]}. Use get_experiment to fetch details if needed.`;
    } else if (featureMatch) {
      pageContext += `\nThey are looking at feature flag: ${featureMatch[1]}. Use get_feature to fetch details if needed.`;
    } else if (metricMatch) {
      pageContext += `\nThey are looking at metric ID: ${metricMatch[1]}.`;
    } else if (factMetricMatch) {
      pageContext += `\nThey are looking at fact metric ID: ${factMetricMatch[1]}.`;
    }
  }

  return `You are Abbie, an intelligent assistant built into the GrowthBook experimentation platform.
You help users understand and manage their experiments, feature flags, metrics, product analytics, and data. 
You can also help them understand how to use GrowthBook and its features. You have access to tools that allow you to fetch data about experiments, features, and metrics, as well as propose changes that the user can confirm. You can also help users with best practices for experimentation and feature management, with hypothesis generation, and analysis of past experiments and data that might be insightful. Even though you are often confused with a racoon (and you hold nothing against racoons), you are actually a purple red panda.

GrowthBook is the most popular open source feature management and experimentation (A/B testing) platform in the universe. 
Feature flags are used to control the rollout of features to users, as defined by the rules added to each feature. One of the rules which can be added to a feature flag is an experiment.
Experiments are used to test changes and measure their impact. Metrics are used to evaluate the success of experiments and monitor the health of the product. Metrics are defined with SQL via fact metrics built on top of fact tables. 
Users can also create metric groups to group related metrics together for easier analysis. Metrics are reusable. Users can also create saved groups, which are reusable audience segments that can be used in feature flag targeting rules.

Current user: ${userName}
Organization: ${orgName}${pageContext}

## GrowthBook Concepts
- **Feature Flags**: Boolean or multivariate flags (identified by a human-readable key like "dark-mode") that control rollouts. Each flag has per-environment settings with targeting rules.
- **Experiments**: A/B tests or multi-variate tests that measure the impact of variations. They have a status (draft/running/stopped), a tracking key, goal metrics, secondary metrics, and guardrail metrics. Experiment urls are of the form /experiment/[experiment id]. 
- **Bandits**: Multi-armed bandit tests that dynamically allocate traffic to winning variations.
- **Holdouts**: Groups of users held back from experiments to measure cumulative experiment impact.
- **Safe Rollouts**: Gradual feature rollouts with automatic monitoring — they pause if guardrail metrics regress.
- **Metrics**: Reusable quantitative measures used to evaluate experiments, or in product analytics. Legacy metrics are defined with SQL directly. Fact Metrics are built on top of Fact Tables (reusable SQL table definitions, that are more efficient to run).
- **Metric Groups**: Named collections of metrics that can be applied to experiments together. Metric in groups can be ordered.
- **Saved Groups**: Reusable sets of rules to define segments used in feature flag targeting rules. Saved groups are passed by reference. 
- **Environments**: Deployment contexts (e.g. "production", "staging") that feature flags are toggled independently per environment. Also, rules are defined per environment, so you can have different targeting rules in staging vs production.
- **Projects**: Organizational grouping. Features, experiments, and metrics can be scoped to projects.
- **Tags**: User-defined labels that can be applied to features, experiments, and metrics for organization and filtering.
- **Users and Permissions**: GrowthBook has a user system with permissions that control access to features, experiments, and metrics. Users can have different roles (e.g. admin, editor, viewer) that grant different levels of access.
- **SDK Connections**: Configuration for client/server SDKs that deliver feature flag values to applications. SDKs ingest feature and experiment configurations, as defined by the SDK connection endpoint (typically), to determine which features/variations a user should see, and send back data for experiment analysis. SDKs are defined per environment, and can be additionally filtered by project. SDK endpoints have a number of options that can be configured, such as secure hashing of values, or cyphered payloads, and which features/experiments are sent to the SDK.
- **Attributes**: User properties (e.g. "country", "plan", "browser") that can be used in targeting rules and experiment segmentation. They are defined in the SDK implementation (done by the customer) and a matching list is of these attributes is created in GrowthBook to allow for easy targeting.

## Guidelines
- Be concise and helpful. Use markdown formatting for readability.
- **Don't expose internal database IDs to the user.** Internal IDs (like "exp_abc123" or "met_xyz789") are not meaningful to users. Always reference items by their human-readable name, tracking key, or feature key. Only use internal IDs when calling tools, or if needed to generate urls.
- When listing items, include key details like name, status, and description — not raw IDs.
- For any write operations (creating features, toggling environments, adding rules), you MUST use the propose_* tools. Never claim to have made changes without using these tools.
- If you're asked for creating new features, the default state should be off for all environments, unless you're asked to make it on. The feature flag type will need to be defined by the user, as it cannot be changed late. The type of flag (boolean, string, number, JSON) can sometimes be determined from context.
- When you don't have enough information, ask clarifying questions.
- Show urls to relevant pages in the GrowthBook app when referencing specific features, experiments, or metrics.
- If the user asks a question that seems related to the page they're currently viewing, use that context to infer what they're asking about. For example, if they're on an experiment page and ask "what are the results?", look up that specific experiment.
- To get more context or information on how GrowthBook works, you can refer to the GrowthBook documentation at https://docs.growthbook.io/ or in examine the code in our various github repos: https://github.com/growthbook/, the main platform repo is: https://github.com/growthbook/growthbook/
- If a user asks about results, provide the data you have and note any limitations.${
    KAPA_AI_API_KEY
      ? `
- When a user asks a technical question about how GrowthBook works — such as how to set something up, how a feature behaves, SDK integration, API usage, or general product questions — use the search_documentation tool to find the most accurate and up-to-date answer from the official documentation and community Q&A. Prefer this over answering from general knowledge when the question is specific to GrowthBook. Do NOT use this tool for questions about the user's own data (experiments, features, metrics), which you should answer using the other tools.`
      : ""
  }${customContext ? `\n\n## Additional Context\n${customContext}` : ""}`;
}

async function searchKapaDocumentation(
  query: string,
): Promise<{ sources: Array<{ url: string; content: string }> }> {
  const response = await fetch(KAPA_AI_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KAPA_AI_API_KEY}`,
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "search_growthbook_knowledge_sources",
        arguments: { query },
      },
      id: 1,
    }),
  });

  let data: unknown;
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream")) {
    // MCP may respond with SSE — find the first data line with a JSON-RPC response
    const text = await response.text();
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ") && line.length > 6) {
        try {
          data = JSON.parse(line.slice(6));
          break;
        } catch {
          // keep scanning
        }
      }
    }
  } else {
    data = await response.json();
  }

  const result = (data as { result?: { content?: unknown[] } } | undefined)
    ?.result;
  if (!result?.content) return { sources: [] };

  const sources: Array<{ url: string; content: string }> = [];
  for (const block of result.content) {
    if (
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      (block as { type: string }).type === "text" &&
      "text" in block
    ) {
      // Each block may be a JSON object with source_url + content, or plain text
      const text = (block as { text: string }).text;
      try {
        const parsed = JSON.parse(text) as unknown;
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "source_url" in parsed
        ) {
          const p = parsed as { source_url?: string; content?: string };
          sources.push({ url: p.source_url || "", content: p.content || text });
          continue;
        }
      } catch {
        // not JSON — treat as plain text
      }
      sources.push({ url: "", content: text });
    }
  }
  return { sources };
}

function getReadTools(context: ReqContext) {
  return {
    search_documentation: tool({
      description:
        "Search GrowthBook documentation and community Q&A. Use this for technical questions about how GrowthBook works: setup, configuration, SDK integration, API usage, feature behaviour, and troubleshooting. Do NOT use this for questions about the user's own experiments, features, or metrics — use the other tools for that.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "The search query — write it as a natural language question",
          ),
      }),
      execute: async ({ query }: { query: string }) => {
        if (!KAPA_AI_API_KEY) {
          return {
            message: "Documentation search is not configured on this instance.",
          };
        }
        try {
          const { sources } = await searchKapaDocumentation(query);
          if (!sources.length) {
            return { message: "No documentation results found." };
          }
          return { sources };
        } catch (err) {
          logger.error(err, "Kapa documentation search failed");
          return {
            message:
              "Documentation search is temporarily unavailable. Try answering from your own knowledge.",
          };
        }
      },
    }),

    list_experiments: tool({
      description:
        "List experiments in the organization. Can filter by status or search by name.",
      inputSchema: z.object({
        status: z
          .enum(["draft", "running", "stopped", "archived"])
          .optional()
          .describe("Filter by experiment status"),
        search: z
          .string()
          .optional()
          .describe("Search term to filter experiment names"),
        project: z.string().optional().describe("Project ID to filter by"),
      }),
      execute: async ({
        status,
        search,
        project,
      }: {
        status?: "draft" | "running" | "stopped" | "archived";
        search?: string;
        project?: string;
      }) => {
        const experiments = await getAllExperiments(context, {
          project,
          includeArchived: status === "archived",
        });

        let filtered = experiments;
        if (status && status !== "archived") {
          filtered = filtered.filter((e) => e.status === status);
        }
        if (search) {
          const searchLower = search.toLowerCase();
          filtered = filtered.filter(
            (e) =>
              e.name.toLowerCase().includes(searchLower) ||
              e.trackingKey?.toLowerCase().includes(searchLower),
          );
        }

        return filtered.slice(0, 50).map((e) => ({
          id: e.id,
          name: e.name,
          status: e.status,
          trackingKey: e.trackingKey,
          hypothesis: e.hypothesis,
          project: e.project,
          tags: e.tags,
          dateCreated: e.dateCreated,
          variations: e.variations?.map((v) => ({
            name: v.name,
            key: v.key,
          })),
        }));
      },
    }),

    get_experiment: tool({
      description:
        "Get detailed information about a specific experiment by its ID.",
      inputSchema: z.object({
        id: z.string().describe("The experiment ID"),
      }),
      execute: async ({ id }: { id: string }) => {
        const experiment = await getExperimentById(context, id);
        if (!experiment) {
          return { error: `Experiment '${id}' not found` };
        }
        return {
          id: experiment.id,
          name: experiment.name,
          status: experiment.status,
          trackingKey: experiment.trackingKey,
          hypothesis: experiment.hypothesis,
          description: experiment.description,
          project: experiment.project,
          tags: experiment.tags,
          owner: experiment.owner,
          dateCreated: experiment.dateCreated,
          dateUpdated: experiment.dateUpdated,
          phases: experiment.phases?.map((p) => ({
            name: p.name,
            dateStarted: p.dateStarted,
            dateEnded: p.dateEnded,
            coverage: p.coverage,
            variationWeights: p.variationWeights,
          })),
          variations: experiment.variations?.map((v) => ({
            name: v.name,
            key: v.key,
            description: v.description,
          })),
          goalMetrics: experiment.goalMetrics,
          guardrailMetrics: experiment.guardrailMetrics,
          results: experiment.results,
          winner: experiment.winner,
          analysis: experiment.analysis,
        };
      },
    }),

    list_features: tool({
      description:
        "List feature flags in the organization. Can search by name.",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe("Search term to filter feature names"),
        project: z.string().optional().describe("Project ID to filter by"),
      }),
      execute: async ({
        search,
        project,
      }: {
        search?: string;
        project?: string;
      }) => {
        const features = await getAllFeatures(context, {
          projects: project ? [project] : undefined,
        });

        let filtered = features.filter((f) => !f.archived);
        if (search) {
          const searchLower = search.toLowerCase();
          filtered = filtered.filter((f) =>
            f.id.toLowerCase().includes(searchLower),
          );
        }

        return filtered.slice(0, 50).map((f) => ({
          id: f.id,
          description: f.description,
          valueType: f.valueType,
          project: f.project,
          tags: f.tags,
          owner: f.owner,
          dateCreated: f.dateCreated,
          environments: Object.entries(f.environmentSettings || {}).map(
            ([env, settings]) => ({
              environment: env,
              enabled: settings.enabled ?? false,
              numRules: settings.rules?.length ?? 0,
            }),
          ),
        }));
      },
    }),

    get_feature: tool({
      description:
        "Get detailed information about a specific feature flag by its ID.",
      inputSchema: z.object({
        id: z.string().describe("The feature flag ID (key)"),
      }),
      execute: async ({ id }: { id: string }) => {
        const feature = await getFeature(context, id);
        if (!feature) {
          return { error: `Feature '${id}' not found` };
        }
        return {
          id: feature.id,
          description: feature.description,
          valueType: feature.valueType,
          defaultValue: feature.defaultValue,
          project: feature.project,
          tags: feature.tags,
          owner: feature.owner,
          dateCreated: feature.dateCreated,
          dateUpdated: feature.dateUpdated,
          environments: Object.entries(feature.environmentSettings || {}).map(
            ([env, settings]) => ({
              environment: env,
              enabled: settings.enabled ?? false,
              rules: settings.rules?.map((r) => ({
                type: r.type,
                description: r.description,
                enabled: r.enabled,
                condition: r.condition,
              })),
            }),
          ),
        };
      },
    }),

    get_environments: tool({
      description: "List all environments in the organization.",
      inputSchema: z.object({}),
      execute: async () => {
        const envs = getEnvironments(context.org);
        return envs.map((e) => ({
          id: e.id,
          description: e.description,
          toggleOnList: e.toggleOnList,
        }));
      },
    }),

    get_projects: tool({
      description: "List all projects in the organization.",
      inputSchema: z.object({}),
      execute: async () => {
        const projects = await context.models.projects.getAll();
        return projects.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          dateCreated: p.dateCreated,
        }));
      },
    }),

    get_metrics: tool({
      description: "List metrics in the organization. Can search by name.",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe("Search term to filter metric names"),
      }),
      execute: async ({ search }: { search?: string }) => {
        const metrics = await getMetricsByOrganization(context);
        let filtered = metrics;
        if (search) {
          const searchLower = search.toLowerCase();
          filtered = filtered.filter(
            (m) =>
              m.name.toLowerCase().includes(searchLower) ||
              m.description?.toLowerCase().includes(searchLower),
          );
        }
        return filtered.slice(0, 50).map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          type: m.type,
          tags: m.tags,
          datasource: m.datasource,
          dateCreated: m.dateCreated,
        }));
      },
    }),
  };
}

function getWriteTools() {
  return {
    propose_toggle_feature: tool({
      description:
        "Propose toggling a feature flag on or off in a specific environment. This requires user confirmation before executing.",
      inputSchema: z.object({
        featureId: z.string().describe("The feature flag ID"),
        environment: z.string().describe("The environment to toggle"),
        enabled: z.boolean().describe("Whether to enable or disable"),
      }),
      execute: async ({
        featureId,
        environment,
        enabled,
      }: {
        featureId: string;
        environment: string;
        enabled: boolean;
      }) => {
        return {
          confirmationRequired: true as const,
          action: "toggle_feature",
          description: `${enabled ? "Enable" : "Disable"} feature "${featureId}" in ${environment}`,
          args: { featureId, environment, enabled },
        };
      },
    }),
  };
}

export async function executeConfirmedAction(
  context: ReqContext,
  action: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (action) {
    case "toggle_feature": {
      const { featureId, environment, enabled } = args as {
        featureId: string;
        environment: string;
        enabled: boolean;
      };
      const feature = await getFeature(context, featureId);
      if (!feature) {
        return `Error: Feature '${featureId}' not found`;
      }
      await toggleFeatureEnvironment(context, feature, environment, enabled);
      return `Successfully ${enabled ? "enabled" : "disabled"} feature "${featureId}" in ${environment}`;
    }
    default:
      return `Unknown action: ${action}`;
  }
}

export async function streamChatResponse({
  context,
  conversationId,
  userMessage,
  currentPage,
  onChunk,
  onToolCall,
  onFinish,
}: {
  context: ReqContext;
  conversationId: string;
  userMessage: string;
  currentPage?: string;
  onChunk: (chunk: string) => void;
  onToolCall: (toolCall: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    result: unknown;
    confirmationRequired?: boolean;
  }) => void;
  onFinish: (fullText: string) => void;
}) {
  const { defaultAIModel, aiChatModel, aiChatContext } = getAISettingsForOrg(
    context,
    true,
  );
  const modelToUse = aiChatModel || defaultAIModel;
  const aiProvider = getAIProviderClass(context, modelToUse);

  // Load existing messages for context
  const existingMessages = await getMessages(conversationId);
  const messages: ModelMessage[] = existingMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  // Add the new user message
  messages.push({ role: "user", content: userMessage });

  // Save user message to DB
  await addMessages(conversationId, [
    {
      conversationId,
      role: "user",
      content: userMessage,
      dateCreated: new Date(),
    },
  ]);

  await updateConversationTimestamp(conversationId);

  const tools = {
    ...getReadTools(context),
    ...getWriteTools(),
  };

  const result = streamText({
    model: aiProvider(modelToUse) as Parameters<typeof streamText>[0]["model"],
    system: getSystemPrompt(context, currentPage, aiChatContext),
    messages,
    tools,
    stopWhen: stepCountIs(5),
  });

  let fullText = "";

  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          fullText += part.text;
          onChunk(part.text);
          break;
        case "tool-result": {
          const toolResult = part as {
            type: "tool-result";
            toolCallId: string;
            toolName: string;
            input?: unknown;
            output?: unknown;
          };
          const output = toolResult.output;
          const isConfirmation =
            typeof output === "object" &&
            output !== null &&
            "confirmationRequired" in output &&
            (output as { confirmationRequired?: boolean }).confirmationRequired;
          onToolCall({
            id: toolResult.toolCallId,
            name: toolResult.toolName,
            args: (toolResult.input as Record<string, unknown>) || {},
            result: output,
            confirmationRequired: isConfirmation,
          });
          break;
        }
      }
    }

    // Save the assistant message to DB
    await addMessages(conversationId, [
      {
        conversationId,
        role: "assistant",
        content: fullText,
        dateCreated: new Date(),
      },
    ]);

    // Track token usage
    const usage = await result.usage;
    if (IS_CLOUD && usage?.totalTokens) {
      await updateTokenUsage({
        numTokensUsed: usage.totalTokens,
        organization: context.org,
      });
    }

    onFinish(fullText);
  } catch (error) {
    logger.error(error, "AI Chat stream error");
    throw error;
  }
}
