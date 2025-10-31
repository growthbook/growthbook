// AI Provider types and configurations
export type AIProvider = "openai" | "anthropic";

export interface AIProviderConfig {
  provider: AIProvider;
  textModel: string;
  embeddingModel?: string;
  maxTokens: number;
  supportsJSON: boolean;
  supportsEmbeddings: boolean;
}

export type AiModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4-turbo"
  | "gpt-4"
  | "gpt-3.5-turbo"
  | "claude-3-5-sonnet-20241022"
  | "claude-3-5-haiku-20241022"
  | "claude-3-opus-20240229"
  | "claude-3-sonnet-20240229"
  | "claude-3-haiku-20240307";

// Available models for each provider
export const AI_PROVIDER_MODEL_MAP: Record<AIProvider, AI_MODELS[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"],
  anthropic: [
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
    "claude-3-sonnet-20240229",
    "claude-3-haiku-20240307",
  ],
};

export const AI_PROVIDER_CONFIGS: Record<AIProvider, AIProviderConfig> = {
  openai: {
    provider: "openai",
    textModel: "gpt-4o-mini",
    embeddingModel: "text-embedding-ada-002",
    maxTokens: 128000,
    supportsJSON: true,
    supportsEmbeddings: true,
  },
  anthropic: {
    provider: "anthropic",
    textModel: "claude-3-haiku-20240307",
    embeddingModel: undefined, // Anthropic doesn't have embedding models
    maxTokens: 200000,
    supportsJSON: true,
    supportsEmbeddings: false,
  },
};

export interface AITokenUsageInterface {
  id?: string;
  organization: string;
  numTokensUsed: number;
  lastResetAt: number;
  dailyLimit: number;
}

export const AI_PROMPT_TYPES = [
  "experiment-analysis",
  "metric-description",
  "experiment-hypothesis",
  "generate-sql-query",
  "generate-experiment-keywords",
  "visual-changeset-copy-transform-energetic",
  "visual-changeset-copy-transform-concise",
  "visual-changeset-copy-transform-humorous",
] as const;
export type AIPromptType = (typeof AI_PROMPT_TYPES)[number];

export interface AIPromptInterface {
  id?: string;
  organization: string;
  type: AIPromptType;
  prompt: string;
}

export const AIPromptDefaults: Record<AIPromptType, string> = {
  "experiment-analysis":
    "Provide a justification for the chosen outcome of the experiment based on the snapshot data" +
    "\nIf the chosen outcome is 'dnf' your output should be in the form 'We are not finishing the experiment because ...' and provide a reason such as that the experiment was underpowered and would take too long to complete.  It needs no sections at all." +
    "\nOtherwise your output should be in the form of two sections '### Key Findings' and '### Conclusions'." +
    "\nFor the Key Findings you should list which metrics had statistically significant winners and by how much, and name the metrics that are unchanged." +
    "\nWhen listing CRs please make sure to use the correct format given the metric type." +
    "\nFor the Conclusions where you state the name of the winning variation and a good, but brief rationale behind that based upon the results of the metrics." +
    "\nThere should be no other headers or sections in your response besides '### Key Findings' and '### Conclusions'" +
    "\nYour output should be in the form of a markdown text, and should be no longer than 2000 characters." +
    "\nIt should not be wrapped in triple backticks." +
    "\nThere is no need to provide metric ids in your answer",
  "metric-description":
    "Write a concise description in markdown of the metric that will be helpful for other users who may want to use this metric in their AB tests. Paraphrase what this metric is used to show or measure.",
  "experiment-hypothesis":
    "A hypothesis is a statement that can be tested. It should be clear, concise, specific, and falsifiable. It should include how the user or product behavior is expected to change, and what metrics we're trying to move with this experiment. It does not need a title.",
  "generate-sql-query": "",
  "generate-experiment-keywords": "", // Always uses the default prompt set in ExperimentModel.ts
  "visual-changeset-copy-transform-energetic": "", // Always uses the default prompt set in postCopyTransform.ts
  "visual-changeset-copy-transform-concise": "", // Always uses the default prompt set in postCopyTransform.ts
  "visual-changeset-copy-transform-humorous": "", // Always uses the default prompt set in postCopyTransform.ts
};
