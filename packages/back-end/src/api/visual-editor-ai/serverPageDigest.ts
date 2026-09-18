import * as cheerio from "cheerio";
import type {
  DomDigest,
  PageStructureNode,
} from "back-end/src/api/visual-editor-ai/domDigest";
import {
  fetchPageHtml,
  parseFetchableEditorUrl,
} from "back-end/src/api/visual-editor-ai/editorUrlFetch";
import {
  bestStemForClass,
  isHashedClass,
  isPreferredAttr,
} from "back-end/src/api/visual-editor-ai/selectorHeuristics";
import { logger } from "back-end/src/util/logger";

export { parseFetchableEditorUrl };

// visual-editor/src/content_script/pageDigest.ts is the source of truth for
// WHAT belongs in a digest. This builds the same catalog over fetched HTML
// (no layout, computed styles, or JavaScript). Every failure returns null:
// a wrong catalog is worse than none — the model grounds selectors in it
// and the self-correct pass trusts them.

type Api = cheerio.CheerioAPI;
type El = {
  type: "tag";
  name: string;
  attribs: Record<string, string>;
  parent?: { type: string; children?: unknown[] } | null;
  children?: Array<{ type: string }>;
};

const isEl = (node: unknown): node is El =>
  typeof node === "object" &&
  node !== null &&
  (node as { type?: string }).type === "tag";

// Cheerio's $() wants its Element class; these are the same parse nodes.
const $el = ($: Api, el: El) => $(el as never);

const tagOf = (el: El): string => (el.name || "").toLowerCase();

const squish = (s: string | null | undefined): string =>
  s ? s.replace(/\s+/g, " ").trim() : "";

const truncate = (s: string, n: number): string =>
  s.length <= n ? s : s.slice(0, n - 1) + "…";

const TEXT_MAX = 120;
const HREF_MAX = 160;

// Skip Tailwind-style idents that need CSS escaping; the structural path covers them.
const CSS_IDENT = /^[A-Za-z_-][\w-]*$/;

const SKIP_ANCESTORS =
  "script, style, noscript, template, head, svg, [hidden], [aria-hidden='true'], [style*='display:none'], [style*='display: none'], [style*='visibility:hidden'], [style*='visibility: hidden']";

const isSkippable = ($: Api, el: El): boolean =>
  $el($, el).closest(SKIP_ANCESTORS).length > 0;

// ponytail: fixed global uniqueness-probe budget. Per-element or memoized
// by selector string only if digest latency actually shows up.
const PROBE_BUDGET = 4000;

type SelectorCtx = { $: Api; cache: Map<El, string>; probes: number };

const isUnique = (ctx: SelectorCtx, selector: string, el: El): boolean => {
  if (ctx.probes >= PROBE_BUDGET) return false;
  ctx.probes++;
  try {
    const found = ctx.$(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
};

const stableClasses = (el: El): string[] =>
  (el.attribs?.class || "")
    .split(/\s+/)
    .filter((c) => c && CSS_IDENT.test(c) && !isHashedClass(c))
    .slice(0, 3);

const SINGLETON_TAGS: ReadonlySet<string> = new Set([
  "html",
  "body",
  "main",
  "header",
  "footer",
  "nav",
  "aside",
  "article",
  "form",
]);

// Preference: id, author-intent attr, stable classes, structural :nth-of-type
// path. Hashed classes are filtered — they would break on the next deploy.
const buildSelector = (ctx: SelectorCtx, el: El): string => {
  const cached = ctx.cache.get(el);
  if (cached !== undefined) return cached;

  const tag = tagOf(el);
  let selector: string | null = null;

  const id = el.attribs?.id;
  if (
    id &&
    CSS_IDENT.test(id) &&
    !isHashedClass(id) &&
    isUnique(ctx, `#${id}`, el)
  ) {
    selector = `#${id}`;
  }

  if (!selector) {
    let tried = 0;
    for (const [name, value] of Object.entries(el.attribs ?? {})) {
      if (tried >= 3) break;
      if (name === "id" || !isPreferredAttr(name, value)) continue;
      if (/["\\\n]/.test(value)) continue;
      tried++;
      const candidate = `${tag}[${name}="${value}"]`;
      if (isUnique(ctx, candidate, el)) {
        selector = candidate;
        break;
      }
    }
  }

  const classes = stableClasses(el);
  if (!selector && classes.length) {
    const candidate = `${tag}.${classes.join(".")}`;
    if (isUnique(ctx, candidate, el)) selector = candidate;
  }

  if (!selector && SINGLETON_TAGS.has(tag) && isUnique(ctx, tag, el)) {
    selector = tag;
  }

  if (!selector) {
    const parent = isEl(el.parent) ? el.parent : null;
    const siblings = (parent?.children ?? [])
      .filter(isEl)
      .filter((n) => tagOf(n) === tag);
    const index = siblings.indexOf(el);
    const segment =
      siblings.length > 1 && index >= 0
        ? `${tag}:nth-of-type(${index + 1})`
        : tag;
    selector = parent ? `${buildSelector(ctx, parent)} > ${segment}` : segment;
  }

  const stem = bestStemForClass(el.attribs?.class || "");
  if (stem) {
    const augmented = `${selector}[class*="${stem}"]`;
    if (isUnique(ctx, augmented, el)) selector = augmented;
  }

  ctx.cache.set(el, selector);
  return selector;
};

const CAPS = {
  headings: 20,
  buttons: 25,
  links: 20,
  inputs: 15,
  images: 15,
  structure: 250,
};

const ACTION_RE =
  /\b(buy|sign up|sign in|log in|get started|start|try|learn more|see (more|all)|book|order|subscribe|download|register|join|continue|next|submit|apply|request|contact|schedule|demo)\b/i;

const collect = (ctx: SelectorCtx, selector: string, cap: number): El[] => {
  const out: El[] = [];
  for (const node of ctx.$(selector).toArray()) {
    if (!isEl(node) || isSkippable(ctx.$, node)) continue;
    out.push(node);
    if (out.length >= cap) break;
  }
  return out;
};

const collectStructural = ($: Api): DomDigest["structural"] => {
  const out: DomDigest["structural"] = [
    { selector: "html", tag: "html", note: "page root" },
    { selector: "body", tag: "body", note: "page body" },
  ];
  const landmarks: DomDigest["structural"] = [
    { selector: "header", tag: "header", note: "site header" },
    { selector: "nav", tag: "nav", note: "primary navigation" },
    { selector: "main", tag: "main", note: "main content landmark" },
    { selector: "aside", tag: "aside", note: "sidebar / aside" },
    { selector: "footer", tag: "footer", note: "site footer" },
    { selector: "article", tag: "article", note: "article container" },
  ];
  for (const l of landmarks) {
    if ($(l.selector).length > 0) out.push(l);
  }
  return out;
};

const collectHeadings = (ctx: SelectorCtx): DomDigest["headings"] => {
  const out: DomDigest["headings"] = [];
  for (const el of collect(ctx, "h1, h2, h3, h4", CAPS.headings)) {
    const text = truncate(squish($el(ctx.$, el).text()), TEXT_MAX);
    if (!text) continue;
    out.push({ selector: buildSelector(ctx, el), tag: tagOf(el), text });
  }
  return out;
};

const collectButtons = (ctx: SelectorCtx): DomDigest["buttons"] => {
  const out: DomDigest["buttons"] = [];
  const seen = new Set<El>();
  const candidates = [
    ...collect(
      ctx,
      'button, input[type="submit"], input[type="button"], [role="button"], a.btn, a.button, a[class*="cta"]',
      CAPS.buttons,
    ),
    ...collect(ctx, "a", CAPS.buttons * 4).filter((a) =>
      ACTION_RE.test(squish($el(ctx.$, a).text())),
    ),
  ];
  for (const el of candidates) {
    if (out.length >= CAPS.buttons) break;
    if (seen.has(el)) continue;
    seen.add(el);
    const tag = tagOf(el);
    let text = squish($el(ctx.$, el).text());
    if (!text && tag === "input") {
      text = el.attribs?.value || el.attribs?.name || "";
    }
    text = truncate(text, TEXT_MAX);
    if (!text) continue;
    const href =
      tag === "a" && el.attribs?.href
        ? truncate(el.attribs.href, HREF_MAX)
        : undefined;
    out.push({ selector: buildSelector(ctx, el), tag, text, href });
  }
  return out;
};

const collectLinks = (
  ctx: SelectorCtx,
  buttonSelectors: Set<string>,
): DomDigest["links"] => {
  const out: DomDigest["links"] = [];
  for (const el of collect(ctx, "a[href]", CAPS.links * 4)) {
    if (out.length >= CAPS.links) break;
    const text = truncate(squish($el(ctx.$, el).text()), TEXT_MAX);
    if (text.length < 3) continue;
    const selector = buildSelector(ctx, el);
    if (buttonSelectors.has(selector)) continue;
    const href = truncate(el.attribs?.href || "", HREF_MAX);
    if (!href) continue;
    out.push({ selector, text, href });
  }
  return out;
};

const inputLabel = (ctx: SelectorCtx, el: El): string | undefined => {
  const aria = el.attribs?.["aria-label"];
  if (aria) return truncate(squish(aria), TEXT_MAX);
  const id = el.attribs?.id;
  if (id && CSS_IDENT.test(id)) {
    const explicit = ctx.$(`label[for="${id}"]`).first();
    if (explicit.length) return truncate(squish(explicit.text()), TEXT_MAX);
  }
  const wrapping = $el(ctx.$, el).closest("label");
  if (wrapping.length) return truncate(squish(wrapping.text()), TEXT_MAX);
  return undefined;
};

const collectInputs = (ctx: SelectorCtx): DomDigest["inputs"] => {
  const out: DomDigest["inputs"] = [];
  const nodes = collect(
    ctx,
    "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select",
    CAPS.inputs,
  );
  for (const el of nodes) {
    const tag = tagOf(el);
    const type =
      tag === "textarea"
        ? "textarea"
        : tag === "select"
          ? "select"
          : el.attribs?.type || "text";
    const placeholder = el.attribs?.placeholder;
    out.push({
      selector: buildSelector(ctx, el),
      type,
      name: el.attribs?.name || undefined,
      placeholder: placeholder
        ? truncate(squish(placeholder), TEXT_MAX)
        : undefined,
      label: inputLabel(ctx, el),
    });
  }
  return out;
};

const collectImages = (ctx: SelectorCtx): DomDigest["images"] => {
  const out: DomDigest["images"] = [];
  for (const el of collect(ctx, "img", CAPS.images * 3)) {
    if (out.length >= CAPS.images) break;
    const width = parseInt(el.attribs?.width ?? "", 10);
    const height = parseInt(el.attribs?.height ?? "", 10);
    if ((width > 0 && width < 24) || (height > 0 && height < 24)) continue;
    const src = truncate(el.attribs?.src || "", HREF_MAX);
    if (!src) continue;
    const alt = el.attribs?.alt;
    out.push({
      selector: buildSelector(ctx, el),
      alt: alt ? truncate(squish(alt), TEXT_MAX) : undefined,
      src,
    });
  }
  return out;
};

const collectStructureSnapshot = (ctx: SelectorCtx): PageStructureNode[] => {
  const ordered: El[] = [];
  const seen = new Set<El>();
  const add = (node: unknown) => {
    if (!isEl(node) || seen.has(node)) return;
    const tag = tagOf(node);
    if (tag === "body" || tag === "html") return;
    seen.add(node);
    ordered.push(node);
  };

  ctx.$("section, article, [role='region'], main > *").each((_, n) => add(n));
  ctx.$("h1, h2, h3").each((_, n) => {
    let node: unknown = n.parent;
    for (
      let hops = 0;
      isEl(node) && tagOf(node) !== "body" && hops < 4;
      hops++
    ) {
      add(node);
      node = node.parent;
    }
  });
  ctx
    .$(
      "[class*='section'], [class*='container'], [class*='wrapper'], [class*='-wrap']",
    )
    .each((_, n) => add(n));

  const nodes: PageStructureNode[] = [];
  const seenSelectors = new Set<string>();
  for (const el of ordered) {
    if (nodes.length >= CAPS.structure) break;
    if (isSkippable(ctx.$, el)) continue;
    const selector = buildSelector(ctx, el);
    if (!selector || seenSelectors.has(selector)) continue;
    seenSelectors.add(selector);

    const parent = isEl(el.parent) ? el.parent : null;
    const parentSelector =
      parent && tagOf(parent) !== "html"
        ? buildSelector(ctx, parent)
        : undefined;
    const classes = (el.attribs?.class || "")
      .split(/\s+/)
      .filter((c) => c && !isHashedClass(c))
      .slice(0, 8);
    const label = squish($el(ctx.$, el).text()).slice(0, 80) || undefined;

    nodes.push({
      selector,
      ...(parentSelector ? { parentSelector } : {}),
      tag: tagOf(el),
      ...(el.attribs?.id ? { id: el.attribs.id } : {}),
      ...(classes.length ? { classes } : {}),
      ...(el.attribs?.role ? { role: el.attribs.role } : {}),
      ...(label ? { label } : {}),
    });
  }
  return nodes;
};

const MIN_BODY_TEXT = 500;
const MIN_CATALOG_ENTRIES = 5;

const SPA_ROOT_IDS = [
  "root",
  "app",
  "__next",
  "__nuxt",
  "___gatsby",
  "svelte",
  "q-app",
];

const visibleBodyTextLength = ($: Api): number => {
  const body = $("body").clone();
  body.find("script, style, noscript, template, svg").remove();
  return squish(body.text()).length;
};

const hasEmptySpaRoot = ($: Api): boolean => {
  for (const id of SPA_ROOT_IDS) {
    const mount = $(`#${id}`);
    if (mount.length > 0 && mount.children().length === 0) return true;
  }
  return false;
};

const catalogEntryCount = (digest: DomDigest): number =>
  digest.headings.length +
  digest.buttons.length +
  digest.links.length +
  digest.inputs.length +
  digest.images.length;

// Hybrid pages that SSR chrome but CSR the body still slip through — nothing
// short of a headless browser detects that.
const looksLikeThinShell = ($: Api): boolean =>
  visibleBodyTextLength($) < MIN_BODY_TEXT || hasEmptySpaRoot($);

export const buildDigestFromEditorUrl = async (
  editorUrl: string,
): Promise<DomDigest | null> => {
  const url = parseFetchableEditorUrl(editorUrl);
  if (!url) {
    logger.info(
      { editorUrl },
      "[visual-editor-ai] editorUrl is not fetchable; skipping server digest",
    );
    return null;
  }

  try {
    const page = await fetchPageHtml(url);
    if (!page) {
      logger.info(
        { url: url.href },
        "[visual-editor-ai] page fetch did not yield a usable 200 HTML response; skipping server digest",
      );
      return null;
    }

    const $ = cheerio.load(page.html);
    if (looksLikeThinShell($)) {
      logger.info(
        { url: url.href },
        "[visual-editor-ai] fetched HTML looks client-rendered or too thin; skipping server digest",
      );
      return null;
    }

    const ctx: SelectorCtx = { $, cache: new Map(), probes: 0 };
    const buttons = collectButtons(ctx);
    const digest: DomDigest = {
      url: page.url.href,
      title: squish($("title").first().text()),
      structural: collectStructural($),
      headings: collectHeadings(ctx),
      buttons,
      links: collectLinks(ctx, new Set(buttons.map((b) => b.selector))),
      inputs: collectInputs(ctx),
      images: collectImages(ctx),
      pageStructure: collectStructureSnapshot(ctx),
    };

    if (catalogEntryCount(digest) < MIN_CATALOG_ENTRIES) {
      logger.info(
        { url: url.href },
        "[visual-editor-ai] fetched HTML looks client-rendered or too thin; skipping server digest",
      );
      return null;
    }

    return digest;
  } catch (e) {
    logger.info(
      { err: e, url: url.href },
      "[visual-editor-ai] server digest build failed; continuing without a digest",
    );
    return null;
  }
};
