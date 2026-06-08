import type { ToolSet } from "ai";
import type { ApiReqContext } from "back-end/types/api";
import { generateImageTool } from "./generateImage";
import { searchImageLibraryTool } from "./searchImageLibrary";
import { getDesignTokensTool } from "./getDesignTokens";
import { searchPastExperimentsTool } from "./searchPastExperiments";
import { getExperimentVariationsTool } from "./getExperimentVariations";
import {
  getComputedStylesTool,
  findElementsTool,
  getInnerHTMLTool,
} from "./clientSideTools";
import type { ClientJob } from "./clientJob";

// Per-turn cap on image generations. Each image is a paid provider
// call plus an upload, so an uncapped tool-calling loop could blow
// through credits + bandwidth fast. Three is high enough for a
// multi-image carousel request, tight enough to bound costs.
const IMAGE_GEN_PER_TURN_MAX = 3;

export interface VisualEditorToolsetOptions {
  context: ApiReqContext;
  // When provided, the toolset includes DOM-side tools that bounce
  // through the client. When omitted, only server-side tools are
  // included — the handler runs as a single HTTP request.
  job?: ClientJob<unknown>;
  // Set to true to suppress tools entirely.
  disabled?: boolean;
}

export function buildVisualEditorTools({
  context,
  job,
  disabled = false,
}: VisualEditorToolsetOptions): ToolSet | undefined {
  if (disabled) return undefined;
  const turnCounter = { count: 0, max: IMAGE_GEN_PER_TURN_MAX };
  const serverTools = {
    generateImage: generateImageTool({ context, turnCounter }),
    searchImageLibrary: searchImageLibraryTool(context),
    getDesignTokens: getDesignTokensTool(context),
    searchPastExperiments: searchPastExperimentsTool(context),
    getExperimentVariations: getExperimentVariationsTool(context),
  };
  if (!job) return serverTools;
  return {
    ...serverTools,
    getComputedStyles: getComputedStylesTool(job),
    findElements: findElementsTool(job),
    getInnerHTML: getInnerHTMLTool(job),
  };
}

// How many LLM round-trips the chat handler permits before forcing a
// final structured output. Each tool call adds a step. Default room for
// e.g. 2-3 image gens + a design-tokens fetch + the final answer.
export const VISUAL_EDITOR_MAX_STEPS = 8;
