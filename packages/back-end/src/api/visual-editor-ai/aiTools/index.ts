import type { ToolSet } from "ai";
import type { ApiReqContext } from "back-end/types/api";
import { hasDocumentOrder } from "back-end/src/api/visual-editor-ai/pageStructure";
import { generateImageTool, type ImageTurnState } from "./generateImage";
import { searchImageLibraryTool } from "./searchImageLibrary";
import { getDesignTokensTool } from "./getDesignTokens";
import { searchPastExperimentsTool } from "./searchPastExperiments";
import { getExperimentVariationsTool } from "./getExperimentVariations";
import {
  deferredDomTools,
  getComputedStylesTool,
  findElementsTool,
  getInnerHTMLTool,
} from "./clientSideTools";
import {
  describeContainerServerTool,
  findElementsServerTool,
  type LookupMemo,
  type PageStructureNode,
} from "./findElementsServer";
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
  // Stateless alternative to `job`: the DOM-side tools are declared without
  // execute(), so a call to one ends the run and is handed back to the
  // extension with a signed transcript. Ignored when `job` is set.
  deferDomTools?: boolean;
  // Page-structure snapshot for the server-side `findElements` tool. When
  // present, the model can locate uncatalogued containers (sections, layout
  // wrappers) without a client round-trip — so it works on Cloud.
  pageStructure?: PageStructureNode[];
  // Set to true to suppress tools entirely.
  disabled?: boolean;
  imageState?: ImageTurnState;
  quarantineImages?: boolean;
  // See GenerateImageToolContext.attachmentCount.
  attachmentCount?: number;
}

export function newImageTurnState(): ImageTurnState {
  return {
    count: 0,
    max: IMAGE_GEN_PER_TURN_MAX,
    generated: [],
    warnings: [],
  };
}

export function buildVisualEditorTools({
  context,
  job,
  deferDomTools = false,
  pageStructure,
  disabled = false,
  imageState,
  quarantineImages = true,
  attachmentCount = 0,
}: VisualEditorToolsetOptions): ToolSet | undefined {
  if (disabled) return undefined;
  const turnCounter = imageState ?? newImageTurnState();
  const hasStructure = !!pageStructure && pageStructure.length > 0;
  // Shared by the two lookup tools so a repeated question is called out.
  const lookups: LookupMemo = new Map();
  const serverTools = {
    generateImage: generateImageTool({
      context,
      turnCounter,
      quarantine: quarantineImages,
      attachmentCount,
    }),
    searchImageLibrary: searchImageLibraryTool(context),
    getDesignTokens: getDesignTokensTool(context),
    searchPastExperiments: searchPastExperimentsTool(context),
    getExperimentVariations: getExperimentVariationsTool(context),
    // Server-side container lookups over the in-request snapshot — work on
    // Cloud (no client round-trip). Only added when the extension sent a
    // snapshot. describeContainer promises siblings and children in page
    // order, which older extensions (capture-priority order, no docOrder)
    // can't back — so it's withheld from them rather than misordering a move.
    ...(hasStructure
      ? {
          findElements: findElementsServerTool(
            pageStructure as PageStructureNode[],
            lookups,
          ),
        }
      : {}),
    ...(hasStructure && hasDocumentOrder(pageStructure as PageStructureNode[])
      ? {
          describeContainer: describeContainerServerTool(
            pageStructure as PageStructureNode[],
            lookups,
          ),
        }
      : {}),
  };
  if (!job && deferDomTools) {
    const deferred = deferredDomTools();
    return {
      ...serverTools,
      getComputedStyles: deferred.getComputedStyles,
      getInnerHTML: deferred.getInnerHTML,
      ...(hasStructure ? {} : { findElements: deferred.findElements }),
    };
  }
  if (!job) return serverTools;
  return {
    ...serverTools,
    getComputedStyles: getComputedStylesTool(job),
    getInnerHTML: getInnerHTMLTool(job),
    // Prefer the server-side snapshot findElements (above) when available;
    // fall back to the client-bounced one only when there's no snapshot.
    ...(hasStructure ? {} : { findElements: findElementsTool(job) }),
  };
}

// How many LLM round-trips the chat handler permits before forcing a
// final structured output. Each tool call adds a step (one call per step on
// Claude, whose json-tool mode disables parallel calls). The ceiling is
// latency, not cost: every step is a full round-trip with the conversation
// resent, lookup steps take a few seconds each, and the extension aborts the
// request at 180s — so 20 leaves room for a long multi-part edit and its
// final, larger answer step, but not for an unbounded exploration.
export const VISUAL_EDITOR_MAX_STEPS = 20;
