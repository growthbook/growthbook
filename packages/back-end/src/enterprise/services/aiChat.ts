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
import { IS_CLOUD } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

function getSystemPrompt(context: ReqContext): string {
  const orgName = context.org.name || "your organization";
  return `You are GrowthBook AI, an intelligent assistant built into the GrowthBook experimentation platform.
You help users understand and manage their experiments, feature flags, metrics, and projects.

Organization: ${orgName}

Guidelines:
- Be concise and helpful. Use markdown formatting for readability.
- When listing items, include key details like status, name, and id.
- For any write operations (creating features, toggling environments, adding rules), you MUST use the propose_* tools. Never claim to have made changes without using these tools.
- When you don't have enough information, ask clarifying questions.
- Reference features and experiments by their names and IDs.
- If a user asks about results, provide the data you have and note any limitations.`;
}

function getReadTools(context: ReqContext) {
  return {
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
  onChunk,
  onToolCall,
  onFinish,
}: {
  context: ReqContext;
  conversationId: string;
  userMessage: string;
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
  const { defaultAIModel } = getAISettingsForOrg(context, true);
  const aiProvider = getAIProviderClass(context, defaultAIModel);

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
    model: aiProvider(defaultAIModel) as Parameters<
      typeof streamText
    >[0]["model"],
    system: getSystemPrompt(context),
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
            (output as { confirmationRequired?: boolean })
              .confirmationRequired === true;
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
