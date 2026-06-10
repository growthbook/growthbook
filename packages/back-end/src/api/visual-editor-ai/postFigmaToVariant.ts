import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { pickVisionModel } from "shared/ai";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  parsePrompt,
  secondsUntilAICanBeUsedAgain,
} from "back-end/src/enterprise/services/ai";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import {
  figmaOAuthConfigured,
  getFigmaNodeTokenSummary,
  getValidFigmaAccessToken,
  parseFigmaFrameUrl,
  renderFigmaNodeImage,
} from "back-end/src/services/figma";
import { requireUserAuth } from "./requireUserAuth";
import { scopeCss } from "./scopeCss";

// Reuse the reference-image shape from image-gen: plain base64, mimeType
// enum, 8 MB cap. No `data:` URL → no SSRF on the mockup-image path.
const designImageSchema = z.object({
  data: z
    .string()
    .min(1)
    .max(8 * 1024 * 1024),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
});

const bodySchema = z
  .object({
    prompt: z.string().min(1).max(2000),
    variationId: z.string(),
    visualChangesetId: z.string(),
    // CSS selector of the container the user picked as the injection point.
    targetSelector: z.string().min(1),
    // "append" → append the component inside the target (last child);
    // "set" → replace the target's contents. These are the only placements
    // dom-mutator can apply as a single, conflict-free mutation (it has no
    // safe "insert new sibling" primitive — see the mutation build below).
    injectionMode: z.enum(["append", "set"]).default("append"),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("figma"), fileUrl: z.string().url() }),
      z.object({ kind: z.literal("image"), image: designImageSchema }),
    ]),
    // Client-formatted token summary for the mockup-image path (the Figma
    // path derives its own from the node tree). Bounded to keep prompt
    // tokens in check.
    designTokens: z.string().max(8000).optional(),
    locale: z
      .string()
      .min(2)
      .max(10)
      .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/)
      .optional(),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/ai/figma-to-variant",
  operationId: "postVisualEditorAIFigmaToVariant",
};

// OpenAI strict JSON mode rejects `.optional()` — use `.nullable()` and
// convert to undefined before returning. The model produces the HTML +
// scoped CSS; the BACKEND builds the actual mutation from targetSelector +
// injectionMode, so the model never has to get the selector/action right.
const outputSchema = z.object({
  html: z
    .string()
    .nullable()
    .describe(
      "Complete HTML markup for the new design component, wrapped in ONE root element carrying the exact scope class given in the prompt. Null when tooLargeWarning is set.",
    ),
  css: z
    .string()
    .nullable()
    .describe(
      "Scoped stylesheet for the component. EVERY rule must be prefixed with the exact scope class given in the prompt. No bare element selectors, no :root/html/body, no global resets. Null when no CSS is needed or tooLargeWarning is set.",
    ),
  js: z
    .string()
    .nullable()
    .describe(
      "Optional JavaScript for interactive behavior only (not styling). Null when not needed.",
    ),
  explanation: z
    .string()
    .describe("One-paragraph summary of what was built, for the editor user."),
  tooLargeWarning: z
    .string()
    .nullable()
    .describe(
      "Set this (a one-sentence reason) ONLY when the design is essentially a full-page redesign that can't be faithfully reproduced as a single scoped in-page component (e.g. a whole new page layout, full navigation overhaul, or many distinct page sections). When set, return html=null and css=null. Otherwise leave null.",
    ),
});

const baseInstructions = `You are GrowthBook's Visual Editor "Figma → Variant" assistant. You are shown an image of a design (a Figma frame or a mockup). Your job is to faithfully reproduce that design as a single, self-contained, testable web component that GrowthBook can inject into a live page as an A/B test variation.

Output a JSON object matching the schema. Build the component as:
1. "html": the markup for the component, wrapped in EXACTLY ONE root element that carries the scope class provided below (e.g. <div class="SCOPE_CLASS"> … </div>). All visible structure goes inside this single root.
2. "css": a stylesheet that styles the component. This is the critical rule: EVERY selector MUST be descendant-scoped under the scope class. Write ".SCOPE_CLASS .title { … }", ".SCOPE_CLASS > * { … }", ".SCOPE_CLASS { … }". NEVER emit a bare element selector (h1{}, button{}, *{}), NEVER use :root / html / body, and NEVER emit a global reset — those leak into and break the host page.
3. "js": only when the component needs interactive behavior (carousels, toggles). Never use JS for styling. Usually null.

Fidelity guidance:
- Match the design's layout, spacing, typography, and colors as closely as you can. Use the structured design tokens (exact hex colors, font families/sizes, frame dimensions) provided below as the source of truth — prefer them over values you'd guess from the image.
- Use semantic, accessible HTML (headings, buttons, lists). Inline SVG is fine for simple icons. For photographic imagery you can't reproduce, use a neutral placeholder background (a solid color or gradient from the palette) rather than hotlinking external assets.
- Keep the component responsive where reasonable (max-width, flex/grid), but don't over-engineer.

If the requested design is too large or structural to be a single in-page component — for example a full new page, a complete navigation/header overhaul, or many independent page sections — do NOT attempt a partial DOM injection. Instead set "tooLargeWarning" to a one-sentence explanation and return html=null and css=null.`;

type InjectionMode = "append" | "set";

function placementSentence(
  injectionMode: InjectionMode,
  targetSelector: string,
): string {
  return injectionMode === "set"
    ? `The component will REPLACE the contents of the target element (${targetSelector}).`
    : `The component will be APPENDED inside the target element (${targetSelector}).`;
}

function buildFigmaUserPrompt({
  prompt,
  scopeClass,
  injectionMode,
  targetSelector,
  tokenSummary,
}: {
  prompt: string;
  scopeClass: string;
  injectionMode: InjectionMode;
  targetSelector: string;
  tokenSummary: string;
}): string {
  const parts: string[] = [];
  parts.push(
    `Scope class to use on the component's single root element and as the prefix for every CSS rule: ${scopeClass}`,
  );
  parts.push(placementSentence(injectionMode, targetSelector));
  if (tokenSummary.trim()) {
    parts.push(
      `Design tokens extracted from the source:\n${tokenSummary.trim()}`,
    );
  }
  parts.push(`User request:\n${prompt}`);
  return parts.join("\n\n");
}

export const postFigmaToVariant = createApiRequestHandler(validation)(async (
  req,
) => {
  const {
    prompt,
    variationId,
    visualChangesetId,
    targetSelector,
    injectionMode,
    source,
    designTokens,
    locale,
  } = req.body;

  const context = req.context;
  requireUserAuth(context);

  const changeset = await findVisualChangesetById(
    visualChangesetId,
    req.organization.id,
  );
  if (!changeset)
    return context.throwNotFoundError("Visual changeset not found");

  const experiment = await getExperimentById(context, changeset.experiment);
  if (!experiment) return context.throwNotFoundError("Experiment not found");
  if (!context.permissions.canUpdateVisualChange(experiment)) {
    context.permissions.throwPermissionError();
  }

  const currentChange = changeset.visualChanges.find(
    (vc) => vc.variation === variationId,
  );
  if (!currentChange) {
    return context.throwBadRequestError(
      "variationId does not belong to the given changeset",
    );
  }

  if (await secondsUntilAICanBeUsedAgain(req.organization)) {
    throw new Error(
      "Daily AI usage limit reached. Try again later or upgrade your plan.",
    );
  }

  const settings = getAISettingsForOrg(context, true);
  if (!settings.aiEnabled) {
    throw new Error(
      "AI features are disabled for this organization. Enable them in Settings → AI Settings.",
    );
  }

  const visionModel = pickVisionModel(settings);
  if (!visionModel) {
    throw new Error(
      "No vision-capable AI model is available. Configure a Google (Gemini), OpenAI (GPT-4o/5), or Anthropic (Claude) API key, or set the Visual Editor model to a vision-capable one in Settings → AI Settings.",
    );
  }

  // Resolve the design image (+ optional token summary).
  let designImage: {
    data: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
  };
  let tokenSummary = "";
  if (source.kind === "figma") {
    if (!figmaOAuthConfigured()) {
      throw new Error(
        "Figma isn't configured for this GrowthBook instance. Paste a mockup image instead, or ask an admin to set up the Figma integration.",
      );
    }
    const parsed = parseFigmaFrameUrl(source.fileUrl);
    if (!parsed) {
      return context.throwBadRequestError(
        "That doesn't look like a Figma frame link. Copy a link to a specific frame (it should include a node-id).",
      );
    }
    const accessToken = await getValidFigmaAccessToken(context);
    const [rendered, summary] = await Promise.all([
      renderFigmaNodeImage({ accessToken, ...parsed }),
      getFigmaNodeTokenSummary({ accessToken, ...parsed }),
    ]);
    designImage = rendered;
    tokenSummary = summary;
  } else {
    designImage = source.image;
    tokenSummary = designTokens ?? "";
  }

  // Unique per-request scope token the model must use verbatim. Generated
  // server-side so the model can't reuse a colliding class across turns.
  const scopeToken = `gbf-${uuidv4().replace(/-/g, "").slice(0, 8)}`;
  const scopeClass = `.${scopeToken}`;

  let instructions = baseInstructions.replace(/SCOPE_CLASS/g, scopeToken);
  if (settings.visualEditorAIContext) {
    instructions = `${instructions}\n\nAdditional brand guidelines / context provided by the organization (respect these unless they conflict with the JSON output schema):\n${settings.visualEditorAIContext}`;
  }
  if (locale && !locale.toLowerCase().startsWith("en")) {
    instructions = `${instructions}\n\nLanguage:\n- The user's interface locale is "${locale}". Write the \`explanation\` field in that language. Keep HTML/CSS/JS, class names, and the JSON keys in English.`;
  }

  logger.info(
    {
      orgId: req.organization.id,
      userId: context.userId,
      visualChangesetId,
      variationId,
      sourceKind: source.kind,
      injectionMode,
      targetSelector,
      visionModel,
      hasTokenSummary: !!tokenSummary,
      designImageBytes: Math.floor((designImage.data.length * 3) / 4),
      promptLength: prompt.length,
    },
    "[visual-editor-ai/figma-to-variant] request",
  );

  const result = await parsePrompt({
    context,
    instructions,
    prompt: buildFigmaUserPrompt({
      prompt,
      scopeClass,
      injectionMode,
      targetSelector,
      tokenSummary,
    }),
    images: [{ data: designImage.data, mimeType: designImage.mimeType }],
    temperature: 0.2,
    type: "visual-editor-ai-figma",
    isDefaultPrompt: true,
    zodObjectSchema: outputSchema,
    overrideModel: visionModel,
    cacheSystemPrompt: true,
  });

  // The model judged the design too large for a scoped in-page component.
  if (result.tooLargeWarning) {
    return {
      mutations: [],
      explanation: result.explanation,
      tooLargeWarning: result.tooLargeWarning,
    };
  }

  const rawHtml = (result.html ?? "").trim();
  if (!rawHtml) {
    return {
      mutations: [],
      explanation:
        result.explanation ||
        "The assistant didn't produce any markup for this design. Try rephrasing or pick a different frame.",
    };
  }

  // Guarantee the injected markup's root carries the scope class so the
  // scoped CSS actually applies (the model is told to wrap it, but wrap
  // defensively when it didn't).
  const html = rawHtml.includes(scopeToken)
    ? rawHtml
    : `<div class="${scopeToken}">${rawHtml}</div>`;

  const scopedCss = result.css ? scopeCss(result.css, scopeClass) : "";

  // One html mutation on the target. dom-mutator (used here AND in the
  // production SDK) only supports html append/set and moving EXISTING
  // elements via `position` — it can't insert a brand-new node as a
  // sibling, so before/after isn't expressible without two mutations that
  // fight each other through its MutationObserver (the html re-assert
  // recreates the node, the position move relocates it, forever). Hence
  // only the two single-mutation placements are supported.
  const mutations = [
    {
      selector: targetSelector,
      action: injectionMode, // "append" (inside) or "set" (replace contents)
      attribute: "html",
      value: html,
    },
  ];

  return {
    mutations,
    ...(scopedCss ? { css: scopedCss } : {}),
    ...(result.js ? { js: result.js } : {}),
    explanation: result.explanation,
  };
});
