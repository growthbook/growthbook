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
import { IS_CLOUD } from "back-end/src/util/secrets";
import { requireUserAuth } from "back-end/src/api/visual-editor-ai/requireUserAuth";
import {
  buildVisualEditorTools,
  VISUAL_EDITOR_MAX_STEPS,
} from "back-end/src/api/visual-editor-ai/aiTools";
import { aiEditJobStore } from "back-end/src/api/visual-editor-ai/aiTools/clientJob";
import {
  buildInsertJs,
  makeScopeToken,
  normalizeInsertPlacement,
  wrapWithScope,
} from "back-end/src/api/visual-editor-ai/insertPrimitive";

// Output-token cap for the edit generation. Above the 8000 parsePrompt
// default because an edit can REPLACE the variation's entire global CSS/JS
// (the model must re-emit all existing rules) — on a large stylesheet that
// blows past 8000 and truncates mid-JSON (NoObjectGeneratedError). 16000
// stays under modern model ceilings; only very old/small self-hosted models
// (8192 cap) could over-shoot. Used for both the main and retry generations.
const EDIT_MAX_OUTPUT_TOKENS = 16000;

const elementContextSchema = z.object({
  selector: z.string(),
  tagName: z.string(),
  textSnippet: z.string(),
  outerHTML: z.string(),
  attrs: z.record(z.string(), z.string()),
  // Computed CSS subset captured at pick time. Lets the model see the
  // CURRENT styling for prompts like "make it more rounded" or "match
  // the header font". Optional for older extensions that don't send it.
  computedStyles: z.record(z.string(), z.string()).optional(),
});

// One container in the page's structural snapshot (sections, layout
// wrappers, ancestors of catalog headings), captured client-side with a
// durable selector precomputed per node. Carried inside domDigest but NEVER
// rendered into the prompt (formatDigest ignores it) — the `findElements`
// tool reads it on demand, so it costs prompt tokens only when the model
// actually needs to locate a container the curated catalog doesn't list
// (e.g. "move the Trusted-by section"). The tool runs server-side over this
// in-request data, so it works on Cloud with no client round-trip.
const structureNodeSchema = z.object({
  selector: z.string(),
  // Durable selector of the nearest significant ancestor — lets the model
  // build a sibling move (parentSelector + insertBefore) from one lookup.
  parentSelector: z.string().optional(),
  tag: z.string(),
  id: z.string().optional(),
  classes: z.array(z.string()).optional(),
  role: z.string().optional(),
  // Short trimmed text label for matching by visible content.
  label: z.string().optional(),
});

// Compact element catalog from visual-editor/src/content_script/pageDigest.ts —
// gives the LLM real selectors to pick from rather than guessing.
const domDigestSchema = z.object({
  url: z.string(),
  title: z.string(),
  // Page-structure entries (html, body, header, main, etc.) — always-valid
  // targets for global styling requests.
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
  // On-demand container map for the `findElements` tool — not rendered into
  // the prompt (formatDigest ignores it).
  pageStructure: z.array(structureNodeSchema).max(400).optional(),
});

// Capped at 12 turns + 4000 chars/turn to bound prompt size.
const conversationTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(4000),
});

const bodySchema = z
  .object({
    prompt: z.string().min(1).max(8000),
    elementContext: z.array(elementContextSchema).max(20).default([]),
    variationId: z.string(),
    visualChangesetId: z.string(),
    domDigest: domDigestSchema.optional(),
    conversationHistory: z.array(conversationTurnSchema).max(12).optional(),
    // BCP-47 primary subtag (with optional region suffix). When non-English,
    // the model writes its `explanation` in that language; mutations/CSS/JS
    // stay language-neutral.
    locale: z
      .string()
      .min(2)
      .max(10)
      .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/)
      .optional(),
    // Opt-in protocol flag. When true, the response is wrapped as
    //   { kind: "final", payload: { mutations, css, js, explanation } }
    // or
    //   { kind: "tool-call", jobId, callId, tool, args }
    // and DOM-side tools (getComputedStyles, findElements, getInnerHTML)
    // are included in the toolset — the client is expected to service
    // their results via POST /visual-editor/ai/edit/resume.
    // When omitted/false, the response is the original unwrapped shape
    // and only server-side tools (generateImage, etc.) are available.
    streamingMode: z.boolean().optional(),
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
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

// OpenAI strict JSON mode rejects `.optional()` — every property must be
// required. We use `.nullable()` and convert nulls to undefined before returning.
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
  options: z
    .array(z.string())
    .nullable()
    .describe(
      'Alternative candidate values for `value`, shown to the user as a pick-one chooser in the UI. Populate ONLY when the user explicitly asks for multiple options/alternatives to choose from (e.g. "give me some alternative titles", "a few hero image options"). Include 2-5 entries. `value` must be your top recommendation AND must also be the first entry of this array. For text, each entry is an alternative string (plain text or HTML, matching the attribute). For images, each entry is a separate generated image URL — call generateImage once per option, never a collage. Null when not offering a choice.',
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
  insert: z
    .array(
      z.object({
        targetSelector: z
          .string()
          .describe(
            'Existing element to position the new content relative to. Must be a real selector from the Page elements catalog (e.g. "body", "header", a section selector). For a site-wide banner at the very top of the page, use "body".',
          ),
        position: z
          .enum(["beforebegin", "afterbegin", "beforeend", "afterend"])
          .describe(
            'Where to place the new content relative to targetSelector: "beforebegin" = immediately before it (previous sibling); "afterbegin" = as its FIRST child (use this with "body" for a banner at the top of the page); "beforeend" = as its LAST child; "afterend" = immediately after it (next sibling).',
          ),
        html: z
          .string()
          .describe(
            "Complete HTML markup for the NEW content only — never include the page's existing DOM. Put styling inline or in the global `css` field. Keep it a single logical block (wrap multiple elements in one container).",
          ),
      }),
    )
    .describe(
      "New elements to INSERT into the page — use this for ANY request to ADD, insert, prepend, or append NEW content (banners, notices, sections, blocks, buttons that don't exist yet). This is the ONLY correct way to add content: NEVER add content by setting/appending \"html\" on body/html or another container (that replaces its entire contents and crashes the page). Return an empty array when the request doesn't add any new elements.",
    ),
  explanation: z
    .string()
    .describe("One-paragraph summary of the changes for the editor user."),
});

// Selectors whose innerHTML must never be replaced.
const PAGE_ROOT_SELECTOR_RE = /^\s*(?::root|html|body)\s*$/i;

// Backstop for the crash the `insert` field + prompt rules are meant to
// prevent: an html mutation is unsafe when it targets a page-root container
// (replacing body/html innerHTML wipes the page, and dom-mutator's observer
// then re-fires → freeze) OR its value echoes whole-document markup (a sign
// the model serialized the existing page instead of a small content swap).
// The same mutation would run in the production SDK, so this guard protects
// real visitors, not just the editor preview.
function isUnsafeHtmlMutation(selector: string, value: string | null): boolean {
  if (PAGE_ROOT_SELECTOR_RE.test(selector)) return true;
  if (value && /<\s*(?:!doctype|html|head|body)[\s>]/i.test(value)) return true;
  return false;
}

const instructions = `You are GrowthBook's Visual Editor assistant. Your job is to translate natural-language change requests into a structured set of DOM mutations that GrowthBook can apply to a web page in an A/B test variation.

Allowed attribute values and what they do:
- "html" — replaces the element's innerHTML. Use this for ANY visible text change (plain text is valid HTML). Example: { selector: ".headline", action: "set", attribute: "html", value: "Welcome back!" }
  CRITICAL: "html" REPLACES everything inside the target element. Only ever target a small, specific element whose entire contents you intend to swap. NEVER use "html" (with "set" OR "append") on "body", "html", ":root", or any large structural/layout container — that destroys the whole page and crashes it. NEVER put the page's existing DOM into an html value (don't echo the current markup back). To ADD new content to the page, use the \`insert\` field (see "Inserting new elements" below) — never an html mutation on a container.
- "style" — replaces the element's inline style. Value is a CSS declaration string, e.g. "display:none" or "color:red;font-size:20px".
- "class" — with action "set" replaces the className, with action "append" adds classes (space-separated).
- "position" — moves the element into a new parent. Use action "set". value MUST be null. Set parentSelector to the destination parent (required, must be in the catalog). Set insertBeforeSelector to a sibling inside that parent to insert this element BEFORE it; omit (null) to append at the end. Example to move a CTA above the headline:
    { selector: ".cta-button", action: "set", attribute: "position", value: null, parentSelector: ".hero", insertBeforeSelector: ".hero-headline" }
  Use moves only when the user explicitly asks to reorder, swap, or relocate elements, AND the elements involved are already direct children of their destination parent. To reorder items that sit inside wrappers (nav menus, lists, cards), prefer a CSS \`order\` rule instead of a move — see "Position-move rules" below.
- Any real HTML attribute name: "src", "href", "alt", "title", "aria-label", "data-foo", etc.

DO NOT invent attribute names. There is NO "text" attribute. To change visible text, ALWAYS use attribute "html". To hide an element use attribute "style" with value containing "display:none".

Inserting new elements (banners, notices, sections, new blocks) — use the \`insert\` field, NOT an html mutation:
- When the user asks to ADD, insert, prepend, append, or place NEW content on the page (a promotional banner, an announcement bar, a new section, a CTA that doesn't exist yet), return it in the \`insert\` array. Do NOT try to add content by setting or appending "html" on "body"/"html"/a container — that replaces the container's entire contents and crashes the page.
- Each insert entry has: \`targetSelector\` (an existing element from the catalog to anchor to), \`position\` (beforebegin / afterbegin / beforeend / afterend, relative to that element), and \`html\` (the NEW markup ONLY — never the page's existing content).
- "A full-width banner at the TOP of the page" → { targetSelector: "body", position: "afterbegin", html: "<div …>…</div>" }. "At the very bottom" → targetSelector "body", position "beforeend". Directly before/after a specific section → that section's selector with "beforebegin"/"afterend".
- Style the inserted markup with inline styles, or add rules to the global \`css\` field. Give your new elements their own class names so your CSS can target them. (If the request wants a photographic image inside the banner, call \`generateImage\` and place the returned URL in the markup.)
- You may return \`insert\` alongside \`mutations\` and \`css\` in one response. Inserts are applied idempotently and are safe on "body". Return an empty \`insert\` array when the request doesn't add any new elements.

Position-move rules (critical):
- A move is applied as parentSelector.insertBefore(element, insertBeforeSelector). The hard DOM requirement is on insertBeforeSelector ONLY: it must resolve to a DIRECT CHILD of parentSelector — it's the reference node the browser inserts before, and insertBefore fails if it isn't a direct child of the parent. The moved element (selector) can live ANYWHERE in the DOM — it's detached from its current spot and re-inserted — so relocating an element into a different container is perfectly valid. The common mistake is naming a deeper descendant as insertBeforeSelector (e.g. a link nested inside a list item), which is NOT a direct child of the parent, so the insert fails.
- parentSelector MUST be a real selector from the Page elements catalog.
- insertBeforeSelector (when provided) MUST also be from the catalog AND be a DIRECT child of parentSelector. If you can't be sure it's a direct child, omit it (null) — appending at the end is safer than guessing.
- Reordering nav / menu / list items — do NOT use a position move on the inner link or text. These items are almost always wrapped (\`<li><a href="…">…</a></li>\`), and the catalog lists the INNER element (e.g. \`[href="#deals"]\`), which is NOT a direct child of the list container — moving it, or naming it as insertBeforeSelector, rips the link out of its \`<li>\` and breaks the nav (this is a common failure). Instead, reorder with a CSS \`order\` rule in the global \`css\` field: the \`css\` field is NOT restricted to catalog selectors, so you can target the wrapper with \`:has()\`, and \`order\` works on flex/grid containers (navs usually are one) without restructuring the DOM. Example — put "Flight Deals" before "Destinations":
    css: \`.nav-links li:has(a[href="#deals"]) { order: -1; }\`
- Real position moves are well-suited to relocating a block-level element into a different container (e.g. moving a <section> to before another <section> under <main>) and to reordering siblings that are themselves direct children of the parent. They're a poor fit for reordering items wrapped in <li>/<div> (nav menus, lists) — prefer the CSS \`order\` approach above for those.
- The source selector and parentSelector must NOT match the same element — that's a no-op or, worse, a self-cycle.
- For every move you propose, set value to null. Do not put position data in value.
- Never combine position with action "append" or "remove". Always action "set".

SELECTOR GROUNDING — this is critical:
- You will be given a "Page elements" catalog with the actual selectors present on the page. It includes a "Page structure" section (html, body, header, main, footer, etc.) plus catalogs of headings, buttons, links, inputs, and images.
- You MUST pick selectors verbatim from this catalog or from the user's picked elementContext. Do NOT invent selectors like ".cta", ".hero-cta", "h1.headline" unless you can see them in the catalog.
- PICKED ELEMENTS WIN — when the user has selected element(s) (the elementContext block, shown below as "selected the following elements … as context"), they are the DEFAULT target: apply the request to the picked element(s) or on an element inside of the context if it makes sense- unless the user's message explicitly names a different one. This takes PRECEDENCE over the keyword/semantic heuristics below. Example: the user picked an \`<div>\` that contains an \`<h2>\` and says "rewrite the heading to be funnier" → edit THAT \`<h2>\`, NOT the page's \`<h1>\`. If the user selects directly a \`<p>\` that contains text, and says to "make it shorter", it should apply directly to that text of the container. Using "this" or other pronouns in the prompt when the context or picked element is passed, refer to that picked element. Only fall back to the keyword/catalog rules when nothing relevant inside the context found or is picked.
- EXCEPTION — selectors the USER names explicitly: when the user's own message contains a concrete class, id, or attribute selector (e.g. "elements with the \`section_bg-gradient-2\` class", "the \`#pricing\` section", "everything matching \`[data-card]\`"), treat it as ground truth and use it verbatim — even if it is NOT in the catalog. The catalog is a NON-EXHAUSTIVE sample: it only lists structural nodes (html/body/header/main/footer…) plus headings, buttons, links, inputs, and images. A class on a \`<section>\`, \`<div>\`, \`<li>\`, etc. will routinely be absent from it. Never refuse or ask for clarification just because a user-supplied class/id isn't in the catalog. The grounding rule above exists to stop you HALLUCINATING selectors from vague descriptions — not to override a selector the user handed you directly.
- Apply any "style every element matching this class / id / attribute" request through GLOBAL CSS (the \`css\` field), not DOM mutations. A CSS rule targets any selector regardless of catalog membership, and styling a whole class of elements is exactly what global CSS is for.
- When the user's request matches a semantic concept (e.g. "the hero CTA", "the signup button"), find the closest match by text content or position in the catalog and use that exact selector.
- "Title" / "the title" / "page title" / "headline" / "heading" → when the user has NOT picked a relevant element (a picked element always wins — see "PICKED ELEMENTS WIN" above), interpret this as the visible main heading on the page — pick the first \`h1\` from the catalog (or the most prominent heading if no h1 is present). NEVER target the \`<title>\` element in \`<head>\`, \`document.title\`, or set the HTML "title" attribute (tooltip) for these requests. Users running an A/B test want to test what readers see on the page, not the browser tab text. The same applies to "subtitle" / "subheading" → the visible \`h2\` (or first heading below the h1), not anything in \`<head>\`.
- For "the page", "the background", "the whole site", "globally", and similar broad requests, prefer "body" or "html" from the Page structure section. These are always valid targets — never refuse a global styling request because the more-specific catalogs only list components.
- "html" and "body" are ALWAYS valid selectors even if the Page structure section is missing (e.g. older content scripts). Treat them as if they were in the catalog.
- If the target is a section or container that isn't in the catalog (e.g. "the Trusted-by section", a named wrapper), call the \`findElements\` tool (when available) to look it up by text or class BEFORE giving up — sections are deliberately absent from the catalog. Only if findElements also finds nothing, the user named no explicit selector, AND the request isn't a global styling change, say so in the explanation and return mutations = []. Do not guess invented selectors.
- Prefer PARTIAL completion over wholesale refusal. When a request has several targets and only some are grounded, fulfill the parts you can — the global/body portion, and any user-named class via global CSS — and note any genuinely unverifiable target in the explanation. Do not refuse the entire request because one target couldn't be confirmed.

Other rules:
- Prefer the smallest, most targeted mutation.
- Reuse selectors from elementContext when relevant.
- When asked to change color/size/spacing, prefer "style" mutations over global CSS.
- Use global CSS for sweeping changes (e.g. "make all buttons green", styling every element matching a class/attribute), for ::pseudo-element edits, and for any CSS \`@keyframes\` animation.
- "Animated" effects are CSS, not images: an animated gradient, shimmering/pulsing/rotating background, "psychedelic rainbow", etc. is a global-CSS \`@keyframes\` + \`animation\` rule (often a \`linear-gradient\` with oversized \`background-size\` animating its \`background-position\`). Do NOT reach for \`generateImage\` for these — it only produces a STATIC image. Reserve \`generateImage\` for requests that genuinely want a photographic/illustrated picture.
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

Tools you may call before producing the final JSON output:
- \`generateImage\` — generate a single AI image and get a hosted URL. Call when the user asks to replace, set, or insert any image (or any background-image). The URL you get back can be placed directly into a mutation's \`value\` — as a \`src\` for <img>, inside a \`background-image: url(...)\` style, or as part of HTML markup for a new <img>. Pick the aspectRatio that matches where the image will appear (16:9 hero, 1:1 avatar, etc.). Call once per image; for multi-image requests (e.g. "build a carousel of 3 slides"), call multiple times. You are budgeted up to 3 image generations per turn.
- \`searchImageLibrary\` — list recent images the user has previously uploaded or generated. Useful when the user says "use one of my existing images" or references a prior visual. The results don't include visual content, only URLs and dates — prefer \`generateImage\` when the user describes a specific look.
- \`getDesignTokens\` — fetch the organization's brand guidelines. Call when the user asks for changes that should be "on brand", "match our style", or "use our colors". Skip for purely tactical edits.
- \`searchPastExperiments\` — search the user's previous A/B tests by name, hypothesis, or description. Call when the user references prior work ("similar to the pricing test", "what's worked here before", "try what we did on signup"). Returns experiment names + hypotheses + ids — never raw conversion numbers or revenue. Use the results to inform DIRECTION ("similar prior tests have leaned warmer/bolder/shorter"), not as a source of quoted numeric claims.
- \`getExperimentVariations\` — given an experimentId from searchPastExperiments, fetch the variations' actual mutations + CSS + JS. Call this when the user explicitly wants to mirror or adapt the changes from a prior experiment. Long mutation values are truncated — treat them as patterns, not as verbatim source.
- \`findElements\` — locate a container/section that is NOT in the page-elements catalog. The catalog only lists headings, buttons, links, inputs, images, and top-level landmarks — it does NOT list \`<section>\`s or layout wrapper \`<div>\`s. When the user refers to a whole section to move, reorder, hide, or restyle (e.g. "move the Trusted-by section above the features section"), call \`findElements\` with a word from the section's visible text or class name to get its durable \`selector\` and \`parentSelector\`. Use those verbatim (they're real, captured from the live DOM). Prefer this over asking the user to click. (Not available on every deployment; if it returns nothing useful, fall back to asking the user to click.)

Tool-use guidance:
- Don't call tools just because they're available. If the user request can be fulfilled with information already in the prompt, return mutations directly without any tool calls.
- ALWAYS finish your turn by emitting the final JSON output that matches the schema — this is mandatory and there is no other valid way to end. Never stop on a tool call, and never reply with prose alone: a turn that ends without the JSON object produces NO output and the whole request fails with an error the user can't act on. This holds even when you cannot complete the request — if a target can't be found (findElements returned nothing, nothing was picked, no explicit selector was given), still return the JSON with mutations: [] and an \`explanation\` saying what you need (e.g. ask the user to click the element). A declined request expressed as valid JSON is a success; a perfect plan left in prose or a dangling tool call is a failure.
- When you place a generated image URL into a mutation, make sure the surrounding markup makes sense: <img> needs src + alt; CSS \`background-image: url(...)\` needs background-size and background-position too; an inserted <img> in an HTML mutation should be wrapped in an appropriate container.
- Past-experiment data is sensitive. When you call \`searchPastExperiments\` or \`getExperimentVariations\`, the chat that contains your explanation persists with the changeset and may later be read by users with different permissions. Never quote specific experiment names, IDs, hypotheses, or numeric outcomes in the \`explanation\` field. Use only directional language ("Similar past tests in this account have favored a warmer color", "Previous attempts have leaned toward shorter copy"). The mutations + CSS + JS you emit are fine — those don't surface raw experiment metadata.

Offering alternatives for the user to choose from:
- When the user asks for MULTIPLE options or alternatives ("give me some alternative titles", "a few fun headline options", "show me a few hero images to pick from"), do NOT pick one silently. Return ONE mutation for the target element with the \`options\` array populated (2-5 candidates) and \`value\` set to your top recommendation (which must also be options[0]). The user picks one in the UI; the chosen value becomes the applied change.
- Text alternatives: each entry in \`options\` is an alternative string (plain text or HTML, matching the attribute — usually "html"). Make them genuinely distinct, not trivial rewordings.
- Image alternatives: call \`generateImage\` once PER option (each a single standalone image — never one collage of variants), then put the returned URLs into \`options\` with \`value\` = the first URL. Respect the per-turn image budget; 2-3 options is plenty.
- Only one element per "alternatives" request. If the user asks for alternatives on several elements at once, return one options-bearing mutation per element.
- For ordinary single changes (no "alternatives"/"options" language), leave \`options\` null and just set \`value\`.

Conversation continuity:
- You may be given a "Previous conversation" block. Use it to resolve pronouns ("it", "them", "the same one") and references to earlier edits. Do not re-apply mutations, or re-insert content, already accepted in earlier turns unless explicitly asked (re-inserting a banner you already added would duplicate it).

Picked-element computed styles:
- Picked elements may carry a \`computedStyles\` map — a subset of the element's CURRENT CSS (font-family, font-size, color, background-color, padding, margin, border, border-radius, box-shadow, etc.) as the browser is rendering it right now.
- Use these as your baseline for relative requests. "More rounded" / "increase the padding" / "darker" / "bigger" should produce a value that's clearly different from the current one, not a generic default. "Match the header style" / "match the buttons above" should mirror those properties exactly when a header or button is also in elementContext.
- Computed values are RESOLVED (e.g. \`color: rgb(0, 0, 0)\`, \`border-radius: 8px\`, not the original keywords). You may emit any equivalent form in your style mutation.
- The keys are CSS property names (kebab-case). When the user describes a relative change, prefer modifying a property that's already set over introducing a new one.
- Do NOT echo every computed style back as a mutation — only emit properties you're actually changing.

When you don't have the reference element's styles:
- If the user asks you to match the style of an element that ISN'T in elementContext (e.g. "match the homepage hero", "make this look like the testimonial cards", "use the same font as the navigation"), you don't have its computed styles — the page-elements catalog only lists selectors and text, not styling.
- Do NOT guess values for the reference element. Inventing a font-family or color you can't see produces a worse result than asking. Specifically: don't return a mutation that hard-codes a font / color / size you guessed.
- Instead, return mutations: [] and use the \`explanation\` field to ask the user to click the reference element on the page (it'll show up as a new picked element with computedStyles, and you can match it on the next turn). Be specific about what they should click — e.g. "Click one of the testimonial cards so I can see its background color and border radius."
- This only applies when the request HINGES on the reference element's actual styling. "Match the header" needs styles. "Move it next to the header" only needs the header's selector, which is in the catalog — proceed normally.

Iterating on existing mutations:
- The "Existing mutations" block shows what's already applied to this variation. When the user wants to MODIFY an existing change (e.g. "actually make it red instead of blue", "increase the size further"), emit a new mutation with the SAME selector + attribute + action as the existing one and the updated value. The back-end automatically deduplicates — your new mutation replaces or merges with the existing one, you don't end up with two contradicting mutations stacked together.
- For style mutations specifically: the merge is property-by-property. So if the existing mutation is "background-color:blue;padding:20px" and the user asks for red, you can emit ONLY "background-color:red" — the existing padding is preserved automatically. Don't restate properties you aren't changing.
- This dedupe only applies when the (selector, attribute, action) triple matches exactly. If the user asks for a genuinely additive change (e.g. existing mutation sets the color; user now wants to also change the font-size), emit a separate mutation for the new property — those won't collide.

Iterating on existing global CSS / JS (different rule from mutations — read carefully):
- The \`css\` and \`js\` fields you return REPLACE the variation's prior global CSS / JS entirely on the back-end. There is NO merge or dedupe (unlike mutations).
- The "Current variation global CSS" / "Current variation global JS" blocks above are the AUTHORITATIVE record of what is currently applied. ALWAYS build your returned CSS/JS from those blocks — never from earlier in the conversation. A rule you proposed in a previous turn is only actually applied if it appears in the Current block; if it doesn't (e.g. the user rejected or undid it), it is NOT applied, so do NOT re-add it. When the Current block says "(none)", return only your new rules.
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

// Bulleted text rather than JSON — fewer tokens, easier for LLMs to scan.
// Selectors wrapped in backticks so the model treats them as opaque strings.
const formatDigest = (digest: z.infer<typeof domDigestSchema>): string => {
  const lines: string[] = [];
  const section = (label: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`\n${label}:`);
    for (const it of items) lines.push(`- ${it}`);
  };
  // Structural section first so the model treats body/html/main as
  // first-class targets for global styling requests, not fallbacks.
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

// Every selector the model can legitimately reference, used by the
// self-correct validation pass to detect hallucinations.
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
  // html/body always resolve, even without a content-script digest.
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
    ? `\nThe user has selected the following elements on the page as context. These are the DEFAULT target for the request — apply the change to them unless the user explicitly names a different element. They take precedence over the "title"/"heading" keyword rules (e.g. a picked <h2> + "rewrite the heading" means THAT <h2>, not the page <h1>):\n\`\`\`json\n${JSON.stringify(elementContext, null, 2)}\n\`\`\`\n`
    : !domDigest
      ? "\n(No specific elements were selected and no page catalog is available. Operate on the user's request alone.)\n"
      : "";

  const existingBlock = existingMutations.length
    ? `\nThe current variation already contains these mutations (do not duplicate them):\n\`\`\`json\n${JSON.stringify(existingMutations, null, 2)}\n\`\`\`\n`
    : "";

  // ALWAYS emit the current-state block, even when empty. This is the
  // authoritative record of what global CSS/JS is currently applied to the
  // variation (the committed changeset). When it's empty we say so explicitly
  // ("(none)") rather than omitting the block — otherwise the model has no
  // anchor and infers the current state from the conversation, which may
  // include changes the user REJECTED or undid (e.g. re-adding a rejected
  // `a{color:red}` on the next turn). The model is instructed to build its
  // returned CSS/JS from THIS block, not from the chat history.
  const existingCssBlock = existingCss
    ? `\nCurrent variation global CSS (authoritative — build on this, not the conversation):\n\`\`\`css\n${existingCss}\n\`\`\`\n`
    : `\nCurrent variation global CSS: (none — this variation has no global CSS applied. Do not re-add CSS from earlier in the conversation; it may have been rejected.)\n`;
  const existingJsBlock = existingJs
    ? `\nCurrent variation global JS (authoritative — build on this, not the conversation):\n\`\`\`js\n${existingJs}\n\`\`\`\n`
    : `\nCurrent variation global JS: (none — this variation has no global JS applied. Do not re-add JS from earlier in the conversation; it may have been rejected.)\n`;

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

  // Carried inside domDigest (sent in the body, kept out of the prompt) and
  // surfaced to the model only via the server-side findElements tool.
  const pageStructure = domDigest?.pageStructure;

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

  if (await secondsUntilAICanBeUsedAgain(req.organization)) {
    throw new Error(
      "Daily AI usage limit reached. Try again later or upgrade your plan.",
    );
  }

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
  // Fail fast on a variationId that isn't part of this changeset.
  // Otherwise currentChange is undefined and the LLM sees empty
  // existing mutations/CSS/JS — a "replace" response would then wipe
  // the variation's real content because the model believes it's blank.
  if (!currentChange) {
    return context.throwBadRequestError(
      "variationId does not belong to the given changeset",
    );
  }

  // Selectors the LLM may reference without triggering a retry.
  // Picked elements are trusted even when not in the digest — the user
  // just clicked them, so they exist.
  const trustedSelectors = new Set<string>();
  if (domDigest) {
    for (const s of allDigestSelectors(domDigest)) trustedSelectors.add(s);
  }
  for (const e of elementContext) trustedSelectors.add(e.selector);
  // Selectors surfaced via the findElements tool are real (the snapshot was
  // built from the live DOM), so trust them too — otherwise a move the model
  // discovered through the tool would be dropped by the self-correct retry.
  if (pageStructure) {
    for (const n of pageStructure) {
      trustedSelectors.add(n.selector);
      if (n.parentSelector) trustedSelectors.add(n.parentSelector);
    }
  }

  // visualEditorAIContext is the free-text brand guidelines admins set in
  // Settings → AI Settings. Appended to the system prompt (not the user
  // message) so the LLM treats it as instructions, not ignorable input.
  const { visualEditorAIModel, visualEditorAIContext } = getAISettingsForOrg(
    context,
    true,
  );
  let effectiveInstructions = visualEditorAIContext
    ? `${instructions}\n\nAdditional brand guidelines / context provided by the organization (these MUST be respected unless they conflict with the JSON output schema):\n${visualEditorAIContext}`
    : instructions;

  if (locale && !locale.toLowerCase().startsWith("en")) {
    effectiveInstructions = `${effectiveInstructions}\n\nLanguage:\n- The user's interface is set to locale "${locale}". Write the \`explanation\` field in that language (the natural language the user reads on screen).\n- Keep the JSON keys, selectors, attribute names, mutation actions ("set"/"append"/"remove"), CSS, JS, and any code identifiers in English — only the explanation prose is localized.`;
  }

  // Single-shot retry without tools — fired by finalize() if the LLM
  // proposed selectors not in the catalog. Tools aren't useful here:
  // the retry hint already names the missing selectors and tells the
  // model to pick from the catalog.
  const runRetry = async (retryHint: string) =>
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
      cacheSystemPrompt: true,
      maxOutputTokens: EDIT_MAX_OUTPUT_TOKENS,
      // This is itself a retry (selector self-correction), so disable
      // parsePrompt's no-object retry — otherwise one request could fan
      // out to 4 LLM calls. finalizeOutput's try/catch already keeps the
      // original result if this correction returns no object.
      retryOnNoObject: false,
    });

  // Every selector a mutation requires on the page. Position moves
  // additionally require parentSelector (and insertBeforeSelector when set).
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

  // Validate selectors, retry once on miss, sanitize, and return the
  // final response shape. Used in both modes — non-streaming inlines
  // it; streaming attaches it to the job so /edit/resume can run the
  // same logic after the LLM's final output arrives.
  const finalizeOutput = async (
    raw: z.infer<typeof outputSchema>,
  ): Promise<{
    mutations: unknown[];
    css?: string;
    js?: string;
    insert?: Array<{
      targetSelector: string;
      position: "beforebegin" | "afterbegin" | "beforeend" | "afterend";
      html: string;
      scopeToken: string;
    }>;
    explanation: string;
  }> => {
    let result = raw;
    if (domDigest && trustedSelectors.size > 0 && result.mutations.length > 0) {
      const misses = result.mutations
        .flatMap(requiredSelectors)
        .filter((s) => !trustedSelectors.has(s));
      if (misses.length > 0) {
        const uniqueMisses = Array.from(new Set(misses));
        const retryHint = `RETRY: Your previous attempt used selectors that are NOT in the page-elements catalog: ${uniqueMisses
          .map((s) => `\`${s}\``)
          .join(
            ", ",
          )}. For position moves, the parent and insert-before targets count too — they must be in the catalog. Resolve this ONE of two ways: (1) if the user NAMED one of these selectors explicitly in their request (a class/id/attribute), it's valid — don't drop it, move that change into the global \`css\` field instead (a CSS rule can target selectors the catalog doesn't list); (2) otherwise pick a matching selector verbatim from the catalog. Only return mutations = [] if neither applies and no catalog entry plausibly matches — and even then, still complete any global/body or user-named-class portion via \`css\`.`;
        try {
          result = await runRetry(retryHint);
        } catch (e) {
          logger.warn(
            { err: e },
            "[visual-editor-ai] self-correct retry failed",
          );
        }
      }
    }

    let droppedUnsafeHtml = false;
    const sanitizedMutations = result.mutations.filter((m) => {
      const attr = m.attribute === "text" ? "html" : m.attribute;
      // Guard (#3): never let an html mutation replace a page-root container
      // or carry whole-document markup. Adding content must go through
      // `insert`; this backstops the prompt rules and protects visitors
      // (the same mutation runs in the SDK).
      if (attr === "html" && isUnsafeHtmlMutation(m.selector, m.value)) {
        droppedUnsafeHtml = true;
        logger.warn(
          { selector: m.selector },
          "[visual-editor-ai] dropping unsafe html mutation (page-root target or full-document value)",
        );
        return false;
      }
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

    // Compile any `insert`s the model returned into idempotent
    // insertAdjacentHTML snippets (see insertPrimitive.ts). Adding new DOM
    // goes through the variation's `js`, never a dom-mutation — dom-mutator
    // has no safe insert primitive.
    const insertDescriptors: Array<{
      targetSelector: string;
      position: "beforebegin" | "afterbegin" | "beforeend" | "afterend";
      html: string;
      scopeToken: string;
    }> = [];
    const insertJsSnippets: string[] = [];
    for (const ins of result.insert) {
      const rawTarget = ins.targetSelector.trim();
      const rawHtml = ins.html.trim();
      if (!rawTarget || !rawHtml) continue;
      // Remap root-relative positions insertAdjacentHTML can't do on <html>
      // (e.g. "beforebegin" on the root) to a valid spot inside <body>, so a
      // top/bottom-of-page insert actually lands instead of silently failing.
      // Normalize once, then use for both the script and the preview descriptor.
      const { targetSelector, position } = normalizeInsertPlacement(
        rawTarget,
        ins.position,
      );
      const scopeToken = makeScopeToken();
      const html = wrapWithScope(rawHtml, scopeToken);
      insertJsSnippets.push(
        buildInsertJs({ scopeToken, targetSelector, position, html }),
      );
      insertDescriptors.push({ targetSelector, position, html, scopeToken });
    }

    // Merge the insert snippets into the variation's JS. The model's `js`
    // (per its contract) is the COMPLETE new global JS; fall back to the
    // existing JS when it left js null, then append our snippets.
    let finalJs: string | undefined;
    if (insertJsSnippets.length > 0) {
      // Only treat the model's `js` as the new base when it actually has
      // content. A schema-valid empty string must NOT drop the variation's
      // existing JS — a plain "add a banner" edit leaves js empty, and `??`
      // wouldn't catch "" (only null/undefined), so fall back explicitly.
      const baseJs =
        result.js && result.js.trim().length > 0
          ? result.js.trim()
          : (currentChange?.js ?? "").trim();
      finalJs = [baseJs, ...insertJsSnippets]
        .filter((s) => s.length > 0)
        .join("\n\n");
    } else if (result.js && result.js !== currentChange?.js) {
      finalJs = result.js;
    }

    let explanation = result.explanation;
    if (droppedUnsafeHtml) {
      explanation +=
        " (Skipped an unsafe change that would have replaced the entire page. To add content to the page, ask me to insert a banner or section instead.)";
    }

    return {
      mutations: sanitizedMutations.map((m) => {
        const attribute = m.attribute === "text" ? "html" : m.attribute;
        const isPosition = attribute === "position";
        // Surface `options` only when it's a genuine multi-choice set
        // (≥2 distinct entries). A single-entry or null options array is
        // just a normal mutation — don't burden the client with a
        // chooser of one. Dedupe defensively (the model occasionally
        // repeats its top pick).
        const opts =
          !isPosition && m.options
            ? Array.from(new Set(m.options.filter((o) => o && o.length > 0)))
            : [];
        return {
          selector: m.selector,
          action: m.action,
          attribute,
          ...(!isPosition && m.value !== null ? { value: m.value } : {}),
          ...(opts.length >= 2 ? { options: opts } : {}),
          ...(isPosition && m.parentSelector
            ? { parentSelector: m.parentSelector }
            : {}),
          ...(isPosition && m.insertBeforeSelector
            ? { insertBeforeSelector: m.insertBeforeSelector }
            : {}),
        };
      }),
      // Drop css/js that's byte-identical to what's already saved. The model
      // is told to return null when it isn't touching global CSS/JS, but
      // stronger models (e.g. Sonnet) often re-emit the full UNCHANGED
      // stylesheet instead — which would surface as a phantom "global CSS
      // change" on every follow-up turn. Treat identical = no change.
      //
      // The leading truthiness check ALSO drops a falsy result (""/null), so
      // CLEARING global CSS/JS via the AI is intentionally not supported: the
      // schema instructs the model never to return an empty string when CSS
      // exists (it would wipe the variation), and we'd rather no-op than risk
      // an accidental wipe. To delete all global CSS/JS, use the manual
      // CSS/JS editor. If deliberate AI clearing is ever wanted, gate it on an
      // explicit signal (e.g. an `intent: "clear"` field) rather than ""/null.
      ...(result.css && result.css !== currentChange?.css
        ? { css: result.css }
        : {}),
      ...(finalJs ? { js: finalJs } : {}),
      ...(insertDescriptors.length > 0 ? { insert: insertDescriptors } : {}),
      explanation,
    };
  };

  // ---- Run the LLM (with tools) via the job-based race. Streaming
  // mode includes DOM-side tools and yields tool-call responses to the
  // client; non-streaming mode runs without DOM tools so the race only
  // ever resolves to "final".
  const streamingMode = !!req.body.streamingMode;
  // The streaming tool loop parks an in-memory job and resumes it via a
  // follow-up /edit/resume request — which only works if the resume hits
  // the SAME process. On Cloud (multi-instance, no affinity) it can hit
  // another instance → "AI edit session not found", and an in-flight
  // generation can't be shared. So skip the DOM-side tool loop on Cloud:
  // run a single-shot generation (server-side tools only) and answer
  // immediately, still returning the {kind:"final"} envelope so the
  // extension's handling is unchanged.
  const useToolLoop = streamingMode && !IS_CLOUD;
  const job = aiEditJobStore.create();
  const tools = buildVisualEditorTools({
    context,
    job: useToolLoop ? job : undefined,
    pageStructure,
  });
  // Cast through unknown — the job store is invariant in TFinal for
  // type-erasure reasons but each job is used with one schema only.
  (
    job as unknown as {
      finalize: (raw: z.infer<typeof outputSchema>) => Promise<unknown>;
    }
  ).finalize = finalizeOutput;

  const generation = parsePrompt({
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
    }),
    temperature: 0.2,
    type: "visual-editor-ai-edit",
    isDefaultPrompt: true,
    zodObjectSchema: outputSchema,
    overrideModel: visualEditorAIModel,
    tools,
    maxSteps: VISUAL_EDITOR_MAX_STEPS,
    cacheSystemPrompt: true,
    maxOutputTokens: EDIT_MAX_OUTPUT_TOKENS,
    // Attach the picked-element selectors to the structured-output failure
    // logs so we can see which selectors (e.g. hashed classes) correlate
    // with "couldn't format a valid response" errors. Diagnostic only.
    logContext: { pickedSelectors: elementContext.map((e) => e.selector) },
    onStepFinish: ({ toolCalls }) => {
      if (toolCalls && toolCalls.length > 0) {
        logger.debug(
          {
            orgId: context.org.id,
            tools: toolCalls.map((c) => c.toolName),
          },
          "[visual-editor-ai/edit] tool calls",
        );
      }
    },
  });
  (
    job as unknown as {
      setGenerationPromise: (p: Promise<unknown>) => void;
    }
  ).setGenerationPromise(generation);

  const outcome = await (
    job as unknown as {
      race: () => Promise<
        | { kind: "toolCall"; callId: string; tool: string; args: unknown }
        | { kind: "final"; payload: z.infer<typeof outputSchema> }
        | { kind: "error"; error: string }
      >;
    }
  ).race();

  if (outcome.kind === "error") {
    aiEditJobStore.delete(job.id);
    throw new Error(outcome.error);
  }
  if (outcome.kind === "toolCall") {
    // DOM-side tools are only attached when useToolLoop is true, so this
    // branch is unreachable otherwise — defensive throw makes that
    // explicit. Server-side tools execute synchronously inside
    // generateText and never reach the race.
    if (!useToolLoop) {
      aiEditJobStore.delete(job.id);
      throw new Error(
        "Internal: unexpected client-side tool call without the tool loop.",
      );
    }
    return {
      kind: "tool-call" as const,
      jobId: job.id,
      callId: outcome.callId,
      tool: outcome.tool,
      args: outcome.args,
    };
  }

  // outcome.kind === "final"
  const finalized = await finalizeOutput(outcome.payload);
  aiEditJobStore.delete(job.id);
  return streamingMode
    ? { kind: "final" as const, payload: finalized }
    : finalized;
});
