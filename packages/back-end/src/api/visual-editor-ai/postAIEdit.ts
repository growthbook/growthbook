import { z } from "zod";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  parsePrompt,
  secondsUntilAICanBeUsedAgain,
} from "back-end/src/enterprise/services/ai";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { requireUserAuth } from "./requireUserAuth";

const elementContextSchema = z.object({
  selector: z.string(),
  tagName: z.string(),
  textSnippet: z.string(),
  outerHTML: z.string(),
  attrs: z.record(z.string(), z.string()),
});

// Compact element catalog assembled by the extension's content script
// (visual-editor/src/content_script/pageDigest.ts). Sent on every edit
// request so the LLM can pick selectors from real elements on the page
// instead of guessing semantic markers that may not exist.
const domDigestSchema = z.object({
  url: z.string(),
  title: z.string(),
  // Page-structure entries (html, body, header, main, footer, etc.).
  // Always-valid targets for global styling requests like "make the
  // background blue" — without these the model has no catalog entry to
  // anchor those mutations to and was refusing them.
  structural: z
    .array(
      z.object({
        selector: z.string(),
        tag: z.string(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  headings: z
    .array(
      z.object({
        selector: z.string(),
        tag: z.string(),
        text: z.string(),
      }),
    )
    .default([]),
  buttons: z
    .array(
      z.object({
        selector: z.string(),
        tag: z.string(),
        text: z.string(),
        href: z.string().optional(),
      }),
    )
    .default([]),
  links: z
    .array(
      z.object({
        selector: z.string(),
        text: z.string(),
        href: z.string(),
      }),
    )
    .default([]),
  inputs: z
    .array(
      z.object({
        selector: z.string(),
        type: z.string(),
        name: z.string().optional(),
        placeholder: z.string().optional(),
        label: z.string().optional(),
      }),
    )
    .default([]),
  images: z
    .array(
      z.object({
        selector: z.string(),
        alt: z.string().optional(),
        src: z.string(),
      }),
    )
    .default([]),
});

// Prior user/assistant turns from the chat log. We cap at 12 to bound the
// prompt size (the extension already trims to the last ~6) and 4000 chars
// per turn so a single rambling assistant turn can't eat the budget.
const conversationTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(4000),
});

const bodySchema = z
  .object({
    prompt: z.string().min(1).max(2000),
    elementContext: z.array(elementContextSchema).max(20).default([]),
    variationId: z.string(),
    visualChangesetId: z.string(),
    domDigest: domDigestSchema.optional(),
    conversationHistory: z.array(conversationTurnSchema).max(12).optional(),
    // BCP-47 primary subtag from the side panel's i18n resolver. We
    // accept a relaxed shape (2-8 chars, optional region suffix) so
    // future locale additions don't need a back-end schema change.
    // When present and not English, the system prompt asks the model
    // to write its `explanation` field in that language. Mutations,
    // CSS, and JS are language-neutral and unaffected.
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
  path: "/visual-editor/ai/edit",
  operationId: "postVisualEditorAIEdit",
};

// NOTE: OpenAI's strict JSON-schema mode requires every property to appear in
// `required`, so `.optional()` is rejected. We use `.nullable()` (key present,
// value may be null) and convert nulls to undefined before returning.
const mutationSchema = z.object({
  selector: z.string().describe("CSS selector for the element to modify"),
  action: z.enum(["set", "append", "remove"]),
  attribute: z
    .string()
    .describe(
      'Which thing on the element to modify. Allowed values: "html" (replaces innerHTML — use this for ANY text or HTML content change), "style" (inline style declaration string), "class" (className), "position" (move the element — see parentSelector + insertBeforeSelector), or any real HTML attribute (e.g. "src", "href", "alt", "title", "aria-label", "data-*"). Do NOT invent attribute names like "text" — use "html" for visible text changes.',
    ),
  value: z
    .string()
    .nullable()
    .describe(
      'New value for set/append. Use null for "remove" and for "position" moves (the destination lives in parentSelector / insertBeforeSelector instead). For "style" use a CSS declaration string, e.g. "display:none;color:red". For "html" provide plain text or HTML markup.',
    ),
  parentSelector: z
    .string()
    .nullable()
    .describe(
      'Position moves only: CSS selector of the destination parent element. Required when attribute === "position", null otherwise. Must be present in the page-elements catalog.',
    ),
  insertBeforeSelector: z
    .string()
    .nullable()
    .describe(
      "Position moves only: CSS selector of the sibling inside parentSelector to insert this element BEFORE. Null to append at the end of the parent. Must be present in the page-elements catalog when provided.",
    ),
});

const outputSchema = z.object({
  mutations: z
    .array(mutationSchema)
    .describe("DOM mutations to apply. Return an empty array when none apply."),
  css: z
    .string()
    .nullable()
    .describe(
      "Complete global CSS for this variation. REPLACES any prior CSS — to add, modify, or remove a rule, return the rest of the existing CSS verbatim alongside your change. Set to null when the user's request doesn't touch global CSS (the existing CSS stays as-is). Do NOT return a partial fragment or an empty string when CSS exists; that wipes it.",
    ),
  js: z
    .string()
    .nullable()
    .describe(
      "Complete global JS for this variation. REPLACES any prior JS — to add, modify, or remove code, return the rest of the existing JS verbatim alongside your change. Set to null when the user's request doesn't touch global JS (the existing JS stays as-is). Do NOT return a partial fragment or an empty string when JS exists; that wipes it.",
    ),
  explanation: z
    .string()
    .describe("One-paragraph summary of the changes for the editor user."),
});

const instructions = `You are GrowthBook's Visual Editor assistant. Your job is to translate natural-language change requests into a structured set of DOM mutations that GrowthBook can apply to a web page in an A/B test variation.

Allowed attribute values and what they do:
- "html" — replaces the element's innerHTML. Use this for ANY visible text change (plain text is valid HTML). Example: { selector: ".headline", action: "set", attribute: "html", value: "Welcome back!" }
- "style" — replaces the element's inline style. Value is a CSS declaration string, e.g. "display:none" or "color:red;font-size:20px".
- "class" — with action "set" replaces the className, with action "append" adds classes (space-separated).
- "position" — moves the element into a new parent. Use action "set". value MUST be null. Set parentSelector to the destination parent (required, must be in the catalog). Set insertBeforeSelector to a sibling inside that parent to insert this element BEFORE it; omit (null) to append at the end. Example to move a CTA above the headline:
    { selector: ".cta-button", action: "set", attribute: "position", value: null, parentSelector: ".hero", insertBeforeSelector: ".hero-headline" }
  Use moves only when the user explicitly asks to reorder, swap, or relocate elements — for purely visual ordering (e.g. "show CTA first"), a CSS "order" style on a flex container is usually safer than a real move.
- Any real HTML attribute name: "src", "href", "alt", "title", "aria-label", "data-foo", etc.

DO NOT invent attribute names. There is NO "text" attribute. To change visible text, ALWAYS use attribute "html". To hide an element use attribute "style" with value containing "display:none".

Position-move rules (critical):
- parentSelector MUST be a real selector from the Page elements catalog.
- insertBeforeSelector (when provided) MUST also be from the catalog AND must be a child of parentSelector on the page. If you can't be sure it's a child, omit it (null) — appending at the end is safer than guessing.
- The source selector and parentSelector must NOT match the same element — that's a no-op or, worse, a self-cycle.
- For every move you propose, set value to null. Do not put position data in value.
- Never combine position with action "append" or "remove". Always action "set".

SELECTOR GROUNDING — this is critical:
- You will be given a "Page elements" catalog with the actual selectors present on the page. It includes a "Page structure" section (html, body, header, main, footer, etc.) plus catalogs of headings, buttons, links, inputs, and images.
- You MUST pick selectors verbatim from this catalog or from the user's picked elementContext. Do NOT invent selectors like ".cta", ".hero-cta", "h1.headline" unless you can see them in the catalog.
- When the user's request matches a semantic concept (e.g. "the hero CTA", "the signup button"), find the closest match by text content or position in the catalog and use that exact selector.
- "Title" / "the title" / "page title" / "headline" → ALWAYS interpret this as the visible main heading on the page — pick the first \`h1\` from the catalog (or the most prominent heading if no h1 is present). NEVER target the \`<title>\` element in \`<head>\`, \`document.title\`, or set the HTML "title" attribute (tooltip) for these requests. Users running an A/B test want to test what readers see on the page, not the browser tab text. The same applies to "subtitle" / "subheading" → the visible \`h2\` (or first heading below the h1), not anything in \`<head>\`.
- For "the page", "the background", "the whole site", "globally", and similar broad requests, prefer "body" or "html" from the Page structure section. These are always valid targets — never refuse a global styling request because the more-specific catalogs only list components.
- "html" and "body" are ALWAYS valid selectors even if the Page structure section is missing (e.g. older content scripts). Treat them as if they were in the catalog.
- If no element in the catalog plausibly matches AND the request isn't a global styling change, say so in the explanation and return mutations = []. Do not guess.

Other rules:
- Prefer the smallest, most targeted mutation.
- Reuse selectors from elementContext when relevant.
- When asked to change color/size/spacing, prefer "style" mutations over global CSS.
- Use global CSS only for sweeping changes (e.g. "make all buttons green") or for ::pseudo-element edits.
- Never produce destructive JS. Only emit JS when the request cannot be done declaratively.

Selector durability — critical for variations that survive future deploys:
- Many sites (Next.js, CSS Modules, styled-components, Emotion, stitches) emit class names that include build-time hashes — e.g. \`styles_slice-homepage__hnn7Q\`, \`css-1abc234\`, \`sc-bdAaNb\`. These hashes ROTATE on every deploy. A mutation anchored to \`.styles_title__hnn7Q\` works today and silently breaks on the next ship.
- The page-elements catalog above and elementContext have already been pre-filtered for you: hashed classes were removed from generated selectors and replaced with \`[class*="stem"]\` partial matches (e.g. \`[class*="slice-homepage"]\`) when a stable middle is recoverable. Trust these — use them verbatim.
- When you must construct a selector that isn't already in the catalog, prefer this order:
  1. \`[data-testid="..."]\`, other \`[data-*]\` attributes, and \`[id]\` — author-defined hooks; most durable.
  2. \`[aria-*]\`, \`[role]\`, \`[name]\`, \`[type]\`, \`[href]\`, \`[alt]\` — semantic attributes.
  3. Semantic tag selectors (\`h1\`, \`nav button\`, \`article\`, \`main > section\`).
  4. \`[class*="stem"]\` partial-class matches (the catalog already does this where possible).
  5. \`nth-of-type(...)\` position selectors — last resort; fragile to sibling additions.
- NEVER emit a hash-bearing class verbatim in a selector. Specifically, do not write \`.styles_*__XXXXX\`, \`.css-XXXXXX\`, \`.sc-XXXXXX\`, or any all-lowercase-and-digits class name of length 8+ that mixes letters and digits — these are bundler hashes that change on every deploy. If those are the only class signals available, switch to a tag + ancestor structural path (e.g. \`section[data-text-color="black"] > div > p\`) anchored under the nearest element that DOES have a stable attribute.

DOM mutations vs global JS precedence — critical:
- Saved DOM mutations re-apply automatically via a MutationObserver. If JS modifies the same element + attribute after the mutation lands, the observer will overwrite the JS change on the next frame. The mutation effectively "wins" against any one-shot JS.
- Therefore: NEVER emit BOTH a DOM mutation AND JS that target the same selector + attribute. Pick exactly one approach:
  • Declarative effects (set text via "html", set style, set class, set src/href, position moves, hide via display:none) → DOM mutation.
  • Imperative effects (event listeners, setInterval/setTimeout, dynamic computation, async work, conditional logic, code that must respond to user interaction) → global JS only. Do not also produce a mutation on that element.
- When in doubt about an overlap: read the "Existing mutations" and "Existing global JS" blocks above. If the request would touch an element already targeted by the other category, switch to the matching approach instead of producing a duplicate.
- Example A — "change the headline to Welcome": DOM mutation on the headline. No JS.
- Example B — "show a countdown timer in the headline that updates every second": JS only — the timer needs to keep writing. Do NOT also emit a mutation setting the headline text, or the mutation will fight the timer.
- Example C — "when the button is clicked, swap its label": JS only — the label change is event-driven. Do NOT emit a class/text mutation on the button.

Conversation continuity:
- You may be given a "Previous conversation" block. Use it to resolve pronouns ("it", "them", "the same one") and references to earlier edits. Do not re-apply mutations already accepted in earlier turns unless explicitly asked.

Iterating on existing mutations:
- The "Existing mutations" block shows what's already applied to this variation. When the user wants to MODIFY an existing change (e.g. "actually make it red instead of blue", "increase the size further"), emit a new mutation with the SAME selector + attribute + action as the existing one and the updated value. The back-end automatically deduplicates — your new mutation replaces or merges with the existing one, you don't end up with two contradicting mutations stacked together.
- For style mutations specifically: the merge is property-by-property. So if the existing mutation is "background-color:blue;padding:20px" and the user asks for red, you can emit ONLY "background-color:red" — the existing padding is preserved automatically. Don't restate properties you aren't changing.
- This dedupe only applies when the (selector, attribute, action) triple matches exactly. If the user asks for a genuinely additive change (e.g. existing mutation sets the color; user now wants to also change the font-size), emit a separate mutation for the new property — those won't collide.

Iterating on existing global CSS / JS (different rule from mutations — read carefully):
- The \`css\` and \`js\` fields you return REPLACE the variation's prior global CSS / JS entirely on the back-end. There is NO merge or dedupe (unlike mutations).
- Always consult the "Current variation global CSS" / "Current variation global JS" blocks above (when present) before deciding what to return.
- When your change ADDS, MODIFIES, or REMOVES a rule in global CSS/JS, return the COMPLETE intended new global CSS/JS — existing rules verbatim, plus/minus/edited rules:
  • ADD a new rule → echo the existing CSS, then append your new rule.
  • MODIFY an existing rule (change a color, swap a value, retarget a selector) → echo the existing CSS with that rule edited in place.
  • REMOVE a rule → echo the existing CSS with that rule omitted.
- Make a best-effort judgment about which intent the user means based on the prior CSS. Examples (assume existing CSS is \`body { background: red; }\`):
  • "Make the background blue instead" → MODIFY: return \`body { background: blue; }\`.
  • "Also make buttons pink" → ADD: return \`body { background: red; }\\n\\nbutton { color: pink; }\`.
  • "Take out the background" → REMOVE: return \`\` (empty string is fine when you intend to wipe the CSS) or the rest of the CSS without that rule.
- Only set \`css\` (or \`js\`) to null when the user's request doesn't involve global CSS (or JS) at all and existing CSS/JS should stay untouched. Returning null when CSS exists is SAFE (no change). Returning a partial fragment when CSS exists is UNSAFE (clobbers it).

Bias toward action when grounded:
- If the catalog contains plausible targets and the request describes a visible change, ALWAYS attempt at least one mutation, with the rationale in the explanation.
- If the request is ambiguous (e.g. "make it pop"), pick the most likely concrete change against a catalog element and call out that choice in the explanation.
- The ONLY cases where you may return an empty mutations array are: (a) the request is unrelated to visual changes (e.g. "how do A/B tests work?"), (b) the request is unsafe, or (c) no catalog element plausibly matches the requested target. In those cases explain in detail what would be needed to proceed.`;

// Flatten the DOM digest into a compact textual catalog. We deliberately use
// indented bullets (not JSON) because LLMs scan structured text faster and
// it costs fewer tokens than the equivalent JSON.stringify output. Selectors
// are wrapped in backticks so the model treats them as opaque strings rather
// than markdown formatting.
const formatDigest = (digest: z.infer<typeof domDigestSchema>): string => {
  const lines: string[] = [];
  const section = (label: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`\n${label}:`);
    for (const it of items) lines.push(`- ${it}`);
  };
  // Structural section first — establishes the always-valid root
  // selectors (body, html, main, etc.) so the model knows it can target
  // them for global styling requests without needing a more specific
  // catalog entry. Listed before headings so it reads as a first-class
  // option, not a fallback.
  section(
    "Page structure",
    digest.structural.map(
      (s) => `\`${s.selector}\` <${s.tag}>${s.note ? ` — ${s.note}` : ""}`,
    ),
  );
  section(
    "Headings",
    digest.headings.map((h) => `\`${h.selector}\` <${h.tag}> "${h.text}"`),
  );
  section(
    "Buttons / CTAs",
    digest.buttons.map(
      (b) =>
        `\`${b.selector}\` <${b.tag}> "${b.text}"${b.href ? ` → ${b.href}` : ""}`,
    ),
  );
  section(
    "Links",
    digest.links.map((l) => `\`${l.selector}\` "${l.text}" → ${l.href}`),
  );
  section(
    "Form fields",
    digest.inputs.map((i) => {
      const meta = [
        i.label ? `label="${i.label}"` : "",
        i.placeholder ? `placeholder="${i.placeholder}"` : "",
        i.name ? `name="${i.name}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `\`${i.selector}\` <${i.type}>${meta ? ` ${meta}` : ""}`;
    }),
  );
  section(
    "Images",
    digest.images.map(
      (img) =>
        `\`${img.selector}\`${img.alt ? ` alt="${img.alt}"` : ""} src=${img.src}`,
    ),
  );
  if (lines.length === 0) {
    return "\n(No editable elements were detected on the page.)\n";
  }
  return `\nPage elements (use selectors verbatim from this catalog):\nURL: ${digest.url}\nTitle: ${digest.title}${lines.join("\n")}\n`;
};

// Collect every selector the model could legitimately reference for the
// self-correct validation pass. Used both to detect hallucinated selectors
// and to remind the model what's actually on the page during a retry.
const allDigestSelectors = (
  digest: z.infer<typeof domDigestSchema>,
): Set<string> => {
  const out = new Set<string>();
  for (const s of digest.structural) out.add(s.selector);
  for (const h of digest.headings) out.add(h.selector);
  for (const b of digest.buttons) out.add(b.selector);
  for (const l of digest.links) out.add(l.selector);
  for (const i of digest.inputs) out.add(i.selector);
  for (const img of digest.images) out.add(img.selector);
  // Universal globals that always resolve on any page. Trusted even
  // when no digest is present so requests like "make the background
  // blue" work without a content script having run.
  out.add("html");
  out.add("body");
  return out;
};

const buildPrompt = ({
  prompt,
  elementContext,
  existingMutations,
  existingCss,
  existingJs,
  domDigest,
  conversationHistory,
  retryHint,
}: {
  prompt: string;
  elementContext: z.infer<typeof elementContextSchema>[];
  existingMutations: {
    selector: string;
    action: string;
    attribute: string;
    value?: string;
  }[];
  existingCss?: string;
  existingJs?: string;
  domDigest?: z.infer<typeof domDigestSchema>;
  conversationHistory?: z.infer<typeof conversationTurnSchema>[];
  retryHint?: string;
}): string => {
  const historyBlock =
    conversationHistory && conversationHistory.length > 0
      ? `\nPrevious conversation (most recent last):\n${conversationHistory
          .map(
            (t) =>
              `${t.role === "user" ? "User" : "Assistant"}: ${t.text.replace(/\n+/g, " ").trim()}`,
          )
          .join("\n")}\n`
      : "";

  const digestBlock = domDigest ? formatDigest(domDigest) : "";

  const contextBlock = elementContext.length
    ? `\nThe user has selected the following elements on the page as context (prefer these targets when they fit the request):\n\`\`\`json\n${JSON.stringify(elementContext, null, 2)}\n\`\`\`\n`
    : !domDigest
      ? "\n(No specific elements were selected and no page catalog is available. Operate on the user's request alone.)\n"
      : "";

  const existingBlock = existingMutations.length
    ? `\nThe current variation already contains these mutations (do not duplicate them):\n\`\`\`json\n${JSON.stringify(existingMutations, null, 2)}\n\`\`\`\n`
    : "";

  const existingCssBlock = existingCss
    ? `\nCurrent variation global CSS:\n\`\`\`css\n${existingCss}\n\`\`\`\n`
    : "";
  const existingJsBlock = existingJs
    ? `\nCurrent variation global JS:\n\`\`\`js\n${existingJs}\n\`\`\`\n`
    : "";

  const retryBlock = retryHint ? `\n${retryHint}\n` : "";

  return `${historyBlock}${digestBlock}${contextBlock}${existingBlock}${existingCssBlock}${existingJsBlock}${retryBlock}
User request:
"""
${prompt}
"""
Return a JSON object that conforms to the response schema.`;
};

export const postAIEdit = createApiRequestHandler(validation)(async (req) => {
  const {
    prompt,
    elementContext,
    variationId,
    visualChangesetId,
    domDigest,
    conversationHistory,
    locale,
  } = req.body;

  const context = req.context;
  // Require PAT auth so AI usage + edits are attributed to a real user.
  // See requireUserAuth.
  requireUserAuth(context);

  const changeset = await findVisualChangesetById(
    visualChangesetId,
    req.organization.id,
  );
  if (!changeset)
    return context.throwNotFoundError("Visual changeset not found");

  // Permission gate: editing AI-proposed mutations against a changeset is
  // equivalent to updating that changeset directly. Load the owning
  // experiment so we can gate on canUpdateVisualChange, mirroring the
  // existing putVisualChangeset endpoint.
  const experiment = await getExperimentById(context, changeset.experiment);
  if (!experiment) return context.throwNotFoundError("Experiment not found");
  if (!context.permissions.canUpdateVisualChange(experiment)) {
    context.permissions.throwPermissionError();
  }

  if (await secondsUntilAICanBeUsedAgain(req.organization)) {
    throw new Error(
      "Daily AI usage limit reached. Try again later or upgrade your plan.",
    );
  }

  // Log the full user prompt for debugging + iteration on the AI flow.
  // Includes the conversation length and the element-context count so
  // we can correlate quality regressions with input shape changes. Full
  // prompt text is captured intentionally — gated by log level + log
  // retention rather than runtime toggle for now. If/when this surface
  // graduates beyond dev/testing, swap for a structured event sink with
  // PII handling instead of relying on logger.info.
  logger.info(
    {
      orgId: req.organization.id,
      userId: context.userId,
      visualChangesetId,
      variationId,
      promptLength: prompt.length,
      conversationTurns: conversationHistory?.length ?? 0,
      elementContextCount: elementContext.length,
      hasDomDigest: !!domDigest,
      prompt,
    },
    "[visual-editor-ai/edit] user prompt",
  );

  const currentChange = changeset.visualChanges.find(
    (vc) => vc.variation === variationId,
  );

  // Selectors the LLM is allowed to reference without triggering a retry.
  // The picked-element selectors are trusted because the user clicked them
  // moments ago — even if they're not in the digest catalog, they exist.
  const trustedSelectors = new Set<string>();
  if (domDigest) {
    for (const s of allDigestSelectors(domDigest)) trustedSelectors.add(s);
  }
  for (const e of elementContext) trustedSelectors.add(e.selector);

  // Resolve the model + brand-context for this surface. visualEditorAIModel
  // falls back to the org's defaultAIModel; visualEditorAIContext is the
  // free-text brand guidelines admins set in Settings → AI Settings →
  // Visual Editor. When non-empty we append it to the instructions so
  // the LLM treats it as part of the system prompt (tone, brand colors,
  // copy style, etc.) rather than as user input that could be ignored.
  const { visualEditorAIModel, visualEditorAIContext } = getAISettingsForOrg(
    context,
    true,
  );
  let effectiveInstructions = visualEditorAIContext
    ? `${instructions}\n\nAdditional brand guidelines / context provided by the organization (these MUST be respected unless they conflict with the JSON output schema):\n${visualEditorAIContext}`
    : instructions;

  // Localized explanation. When the user has set a non-English locale in
  // the side panel's language picker, ask the model to write its prose
  // output (`explanation`) in that language. Mutations, CSS, and JS are
  // language-neutral so they stay as-is. We only act when the locale is
  // present AND non-English — null/missing means "no preference, model
  // default (English)" which keeps existing behavior for old clients.
  if (locale && !locale.toLowerCase().startsWith("en")) {
    effectiveInstructions = `${effectiveInstructions}\n\nLanguage:\n- The user's interface is set to locale "${locale}". Write the \`explanation\` field in that language (the natural language the user reads on screen).\n- Keep the JSON keys, selectors, attribute names, mutation actions ("set"/"append"/"remove"), CSS, JS, and any code identifiers in English — only the explanation prose is localized.`;
  }

  const runModel = async (retryHint?: string) =>
    parsePrompt({
      context,
      instructions: effectiveInstructions,
      prompt: buildPrompt({
        prompt,
        elementContext,
        existingMutations: currentChange?.domMutations ?? [],
        existingCss: currentChange?.css,
        existingJs: currentChange?.js,
        domDigest,
        conversationHistory,
        retryHint,
      }),
      temperature: 0.2,
      type: "visual-editor-ai-edit",
      isDefaultPrompt: true,
      zodObjectSchema: outputSchema,
      overrideModel: visualEditorAIModel,
    });

  let result = await runModel();

  // Helper: every selector a mutation REQUIRES to exist on the page. For
  // a standard mutation that's just `selector`; for a "position" move we
  // also need parentSelector and (when present) insertBeforeSelector — all
  // three have to land somewhere real before we propose the move.
  const requiredSelectors = (m: {
    selector: string;
    attribute: string;
    parentSelector?: string | null;
    insertBeforeSelector?: string | null;
  }): string[] => {
    if (m.attribute !== "position") return [m.selector];
    return [
      m.selector,
      ...(m.parentSelector ? [m.parentSelector] : []),
      ...(m.insertBeforeSelector ? [m.insertBeforeSelector] : []),
    ];
  };

  // Self-correct loop: if the digest is present, every proposed selector
  // must either appear in the digest or in the picked-element context.
  // When the model hallucinates a selector that's not in either, we feed
  // it back ONCE with an explicit list of misses and the catalog already
  // attached to the prompt. We don't loop indefinitely — one retry is the
  // sweet spot between latency cost and accuracy gain.
  if (domDigest && trustedSelectors.size > 0 && result.mutations.length > 0) {
    const misses = result.mutations
      .flatMap(requiredSelectors)
      .filter((s) => !trustedSelectors.has(s));
    if (misses.length > 0) {
      const uniqueMisses = Array.from(new Set(misses));
      const retryHint = `RETRY: Your previous attempt used selectors that are NOT on the page: ${uniqueMisses
        .map((s) => `\`${s}\``)
        .join(
          ", ",
        )}. Pick selectors verbatim from the "Page elements" catalog above. For position moves, the parent and insert-before targets count too — they must also be in the catalog. If no catalog entry plausibly matches a target, return mutations = [] and explain why.`;
      try {
        result = await runModel(retryHint);
      } catch (e) {
        // If the retry call itself fails (rate limit, network), keep the
        // original response — the front-end's live-DOM selector validator
        // will still surface any remaining misses to the user.
        logger.warn({ err: e }, "[visual-editor-ai] self-correct retry failed");
      }
    }
  }

  // Drop moves the LLM produced that violate our safety rules. We do this
  // server-side (rather than relying on the model) because LLMs occasionally
  // generate technically-valid-but-meaningless moves like
  // { selector: "X", parentSelector: "X" } that would crash dom-mutator or
  // produce a no-op. We log + skip; legitimate mutations in the same turn
  // still flow through.
  const sanitizedMutations = result.mutations.filter((m) => {
    if (m.attribute !== "position") return true;
    if (!m.parentSelector) {
      logger.warn(
        { selector: m.selector },
        "[visual-editor-ai] dropping position mutation: missing parentSelector",
      );
      return false;
    }
    if (m.parentSelector === m.selector) {
      logger.warn(
        { selector: m.selector },
        "[visual-editor-ai] dropping self-targeting position mutation",
      );
      return false;
    }
    if (m.insertBeforeSelector && m.insertBeforeSelector === m.selector) {
      logger.warn(
        { selector: m.selector },
        "[visual-editor-ai] dropping position mutation: insertBefore == selector",
      );
      return false;
    }
    return true;
  });

  return {
    mutations: sanitizedMutations.map((m) => {
      // Safety net: dom-mutator has no special "text" attribute — using it
      // literally sets a text="…" attribute. Coerce to "html" so the AI's
      // intent (change visible text) actually changes visible text.
      const attribute = m.attribute === "text" ? "html" : m.attribute;
      const isPosition = attribute === "position";
      return {
        selector: m.selector,
        action: m.action,
        attribute,
        // Position moves carry no value (the destination is captured in
        // parentSelector / insertBeforeSelector). For other actions, only
        // include value when the LLM actually supplied one.
        ...(!isPosition && m.value !== null ? { value: m.value } : {}),
        ...(isPosition && m.parentSelector
          ? { parentSelector: m.parentSelector }
          : {}),
        ...(isPosition && m.insertBeforeSelector
          ? { insertBeforeSelector: m.insertBeforeSelector }
          : {}),
      };
    }),
    ...(result.css ? { css: result.css } : {}),
    ...(result.js ? { js: result.js } : {}),
    explanation: result.explanation,
  };
});
