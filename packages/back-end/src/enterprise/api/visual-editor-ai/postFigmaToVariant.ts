import { z } from "zod";
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
import { requireUserAuth } from "back-end/src/api/visual-editor-ai/requireUserAuth";
import { scopeCss } from "back-end/src/api/visual-editor-ai/scopeCss";
import {
  buildInsertJs,
  makeScopeToken,
  wrapWithScope,
} from "back-end/src/api/visual-editor-ai/insertPrimitive";

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
    // CSS selector of the element the user picked as the injection point.
    targetSelector: z.string().min(1),
    // Placement relative to the target:
    //   "append" → inside, last child   · "before" → previous sibling
    //   "set"    → replace its contents  · "after"  → next sibling
    // Insert modes (append/before/after) are emitted as a `js` snippet
    // (insertAdjacentHTML) — NOT a dom-mutation — because dom-mutator
    // re-asserts/duplicates appended HTML on every subtree change (it has
    // no safe insert primitive). "set" stays a dom-mutation (it converges).
    injectionMode: z
      .enum(["append", "set", "before", "after"])
      .default("append"),
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

// HTTP response shape. "Replace contents" returns a single dom-mutator
// `html`/`set` mutation; insert modes return an empty `mutations` array
// plus an `insert` descriptor + the idempotent `js`. `css`/`js`/`insert`/
// `tooLargeWarning` are each present only in the relevant branch.
const responseSchema = z.object({
  mutations: z.array(
    z.object({
      selector: z.string(),
      action: z.literal("set"),
      attribute: z.literal("html"),
      value: z.string(),
    }),
  ),
  explanation: z.string(),
  insert: z
    .object({
      targetSelector: z.string(),
      position: z.enum(["beforeend", "beforebegin", "afterend"]),
      html: z.string(),
      scopeToken: z.string(),
    })
    .optional(),
  js: z.string().optional(),
  css: z.string().optional(),
  tooLargeWarning: z.string().optional(),
});

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema,
  method: "post" as const,
  path: "/visual-editor/ai/figma-to-variant",
  operationId: "postVisualEditorAIFigmaToVariant",
  // Internal endpoint used only by the Visual Editor extension — keep it
  // out of the public OpenAPI spec.
  excludeFromSpec: true,
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

type InjectionMode = "append" | "set" | "before" | "after";

// insertAdjacentHTML position for each insert mode. (A narrow subset of the
// shared InsertPosition type — Figma only ever inserts before/after/append,
// never afterbegin. Assignable to buildInsertJs's wider position param.)
const INSERT_POSITION: Record<
  Exclude<InjectionMode, "set">,
  "beforeend" | "beforebegin" | "afterend"
> = {
  append: "beforeend",
  before: "beforebegin",
  after: "afterend",
};

function placementSentence(
  injectionMode: InjectionMode,
  targetSelector: string,
): string {
  switch (injectionMode) {
    case "set":
      return `The component will REPLACE the contents of the target element (${targetSelector}).`;
    case "before":
      return `The component will be inserted immediately BEFORE the target element (${targetSelector}), as its previous sibling.`;
    case "after":
      return `The component will be inserted immediately AFTER the target element (${targetSelector}), as its next sibling.`;
    case "append":
    default:
      return `The component will be APPENDED inside the target element (${targetSelector}).`;
  }
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

  // "Replace contents" sets the target's innerHTML; doing that to body/html
  // would wipe the whole page. (Insert modes are fine on any target.)
  if (
    injectionMode === "set" &&
    /^\s*(body|html|:root)\s*$/i.test(targetSelector)
  ) {
    return context.throwBadRequestError(
      "Pick a specific container to replace — replacing the contents of <body>/<html> would wipe the page. Use 'Append inside' to add to the page instead.",
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
  const scopeToken = makeScopeToken();
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
    // Figma → Variant emits a whole component's HTML + scoped CSS, the
    // largest single artifact this codebase generates. Raise the cap well
    // above the 8000 default so big components don't truncate mid-JSON
    // (NoObjectGeneratedError). 16000 stays under modern model ceilings;
    // very old/small self-hosted models (8192 cap) are the only ones this
    // could over-shoot.
    maxOutputTokens: 16000,
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
  const html = wrapWithScope(rawHtml, scopeToken);

  const scopedCss = result.css ? scopeCss(result.css, scopeClass) : "";

  // "Replace contents" → a dom-mutator `html` `set` mutation. `set`
  // re-asserts a FIXED string, so it converges (no multiplication) and is
  // cleanly revertable + lazy-binds to late targets.
  if (injectionMode === "set") {
    return {
      mutations: [
        {
          selector: targetSelector,
          action: "set",
          attribute: "html",
          value: html,
        },
      ],
      ...(scopedCss ? { css: scopedCss } : {}),
      explanation: result.explanation,
    };
  }

  // Insert modes (append/before/after) → inject via the variation's `js`
  // field (insertAdjacentHTML), NOT a dom-mutation. dom-mutator re-asserts
  // appended HTML on every subtree change (duplicating it → page freeze,
  // guaranteed on body), and the same dom-mutator runs in the production
  // SDK. The SDK applies `js` as a one-shot <script> with no observer, so
  // an idempotent insert runs exactly once. `insert` is the descriptor the
  // editor uses to live-preview the same insertion revertably.
  const position = INSERT_POSITION[injectionMode];
  const insertJs = buildInsertJs({
    scopeToken,
    targetSelector,
    position,
    html,
  });
  // Append our insertion after any JS the model returned (rare).
  const js = result.js ? `${result.js}\n${insertJs}` : insertJs;

  return {
    mutations: [],
    insert: { targetSelector, position, html, scopeToken },
    js,
    ...(scopedCss ? { css: scopedCss } : {}),
    explanation: result.explanation,
  };
});
