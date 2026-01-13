// AI Provider types and configurations
export type AIProvider = "openai" | "anthropic";

export type EmbeddingModel =
  | "text-embedding-3-small"
  | "text-embedding-3-large"
  | "text-embedding-ada-002";

// Available models for each provider
export const AI_PROVIDER_MODEL_MAP = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  anthropic: [
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-5-20250929",
    "claude-opus-4-1-20250805",
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-haiku-20241022",
    "claude-3-haiku-20240307",
  ],
} as const;

// Derive AIModel type from the models defined in AI_PROVIDER_MODEL_MAP
export type AIModel = (typeof AI_PROVIDER_MODEL_MAP)[AIProvider][number];

// Helper to determine which provider a model belongs to
export function getProviderFromModel(model: AIModel): AIProvider {
  for (const [provider, models] of Object.entries(AI_PROVIDER_MODEL_MAP)) {
    if (models.includes(model as never)) {
      return provider as AIProvider;
    }
  }
  throw new Error(`Model ${model} is not supported.`);
}

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
  overrideModel?: string;
}

export const AI_PROMPT_DEFAULTS: Record<AIPromptType, string> = {
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

// Prompt types that have default values and can be customized by users
export const CUSTOMIZABLE_PROMPT_TYPES = Object.keys(AI_PROMPT_DEFAULTS).filter(
  (key) =>
    AI_PROMPT_DEFAULTS[key as AIPromptType] !== "" ||
    key === "generate-sql-query",
) as AIPromptType[];
