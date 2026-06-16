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
import { requireUserAuth } from "./requireUserAuth";
import { buildVisualEditorTools, VISUAL_EDITOR_MAX_STEPS } from "./aiTools";
import { aiEditJobStore } from "./aiTools/clientJob";

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
});

// Capped at 12 turns + 4000 chars/turn to bound prompt size.
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

Tools you may call before producing the final JSON output:
- \`generateImage\` — generate a single AI image and get a hosted URL. Call when the user asks to replace, set, or insert any image (or any background-image). The URL you get back can be placed directly into a mutation's \`value\` — as a \`src\` for <img>, inside a \`background-image: url(...)\` style, or as part of HTML markup for a new <img>. Pick the aspectRatio that matches where the image will appear (16:9 hero, 1:1 avatar, etc.). Call once per image; for multi-image requests (e.g. "build a carousel of 3 slides"), call multiple times. You are budgeted up to 3 image generations per turn.
- \`searchImageLibrary\` — list recent images the user has previously uploaded or generated. Useful when the user says "use one of my existing images" or references a prior visual. The results don't include visual content, only URLs and dates — prefer \`generateImage\` when the user describes a specific look.
- \`getDesignTokens\` — fetch the organization's brand guidelines. Call when the user asks for changes that should be "on brand", "match our style", or "use our colors". Skip for purely tactical edits.
- \`searchPastExperiments\` — search the user's previous A/B tests by name, hypothesis, or description. Call when the user references prior work ("similar to the pricing test", "what's worked here before", "try what we did on signup"). Returns experiment names + hypotheses + ids — never raw conversion numbers or revenue. Use the results to inform DIRECTION ("similar prior tests have leaned warmer/bolder/shorter"), not as a source of quoted numeric claims.
- \`getExperimentVariations\` — given an experimentId from searchPastExperiments, fetch the variations' actual mutations + CSS + JS. Call this when the user explicitly wants to mirror or adapt the changes from a prior experiment. Long mutation values are truncated — treat them as patterns, not as verbatim source.

Tool-use guidance:
- Don't call tools just because they're available. If the user request can be fulfilled with information already in the prompt, return mutations directly without any tool calls.
- After all needed tool results are in hand, emit the final JSON output that matches the schema — never trail an explanation after a tool result without producing the JSON.
- When you place a generated image URL into a mutation, make sure the surrounding markup makes sense: <img> needs src + alt; CSS \`background-image: url(...)\` needs background-size and background-position too; an inserted <img> in an HTML mutation should be wrapped in an appropriate container.
- Past-experiment data is sensitive. When you call \`searchPastExperiments\` or \`getExperimentVariations\`, the chat that contains your explanation persists with the changeset and may later be read by users with different permissions. Never quote specific experiment names, IDs, hypotheses, or numeric outcomes in the \`explanation\` field. Use only directional language ("Similar past tests in this account have favored a warmer color", "Previous attempts have leaned toward shorter copy"). The mutations + CSS + JS you emit are fine — those don't surface raw experiment metadata.

Offering alternatives for the user to choose from:
- When the user asks for MULTIPLE options or alternatives ("give me some alternative titles", "a few fun headline options", "show me a few hero images to pick from"), do NOT pick one silently. Return ONE mutation for the target element with the \`options\` array populated (2-5 candidates) and \`value\` set to your top recommendation (which must also be options[0]). The user picks one in the UI; the chosen value becomes the applied change.
- Text alternatives: each entry in \`options\` is an alternative string (plain text or HTML, matching the attribute — usually "html"). Make them genuinely distinct, not trivial rewordings.
- Image alternatives: call \`generateImage\` once PER option (each a single standalone image — never one collage of variants), then put the returned URLs into \`options\` with \`value\` = the first URL. Respect the per-turn image budget; 2-3 options is plenty.
- Only one element per "alternatives" request. If the user asks for alternatives on several elements at once, return one options-bearing mutation per element.
- For ordinary single changes (no "alternatives"/"options" language), leave \`options\` null and just set \`value\`.

Conversation continuity:
- You may be given a "Previous conversation" block. Use it to resolve pronouns ("it", "them", "the same one") and references to earlier edits. Do not re-apply mutations already accepted in earlier turns unless explicitly asked.

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
    explanation: string;
  }> => {
    let result = raw;
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
          result = await runRetry(retryHint);
        } catch (e) {
          logger.warn(
            { err: e },
            "[visual-editor-ai] self-correct retry failed",
          );
        }
      }
    }

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
      ...(result.css ? { css: result.css } : {}),
      ...(result.js ? { js: result.js } : {}),
      explanation: result.explanation,
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
