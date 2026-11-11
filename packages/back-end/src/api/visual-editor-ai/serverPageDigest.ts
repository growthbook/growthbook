import * as cheerio from "cheerio";
import type { DomDigest } from "back-end/src/api/visual-editor-ai/domDigest";
import type { PageStructureNode } from "back-end/src/api/visual-editor-ai/pageStructure";
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

// visual-editor/src/content_script/pageDigest.ts is the source of truth for
// WHAT belongs in a digest. This builds the same catalog over fetched HTML
// (no layout, computed styles, or JavaScript). Every failure returns null:
// a wrong catalog is worse than none — the model grounds selectors in it
// and the self-correct pass trusts them.

type Api = cheerio.CheerioAPI;
type DomNode = {
  type: string;
  name?: string;
  data?: string;
  parent?: DomNode | null;
  prev?: DomNode | null;
  next?: DomNode | null;
  children?: DomNode[];
};
type El = DomNode & {
  type: "tag";
  name: string;
  attribs: Record<string, string>;
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

// A node's squished text, exact for at least its first `min` characters. Stops
// reading once it has them, so a large subtree costs no more than a small one.
const leadingText = (
  root: DomNode,
  min: number,
  skipTags?: ReadonlySet<string>,
): string => {
  const chunks: string[] = [];
  let seen = 0;
  const walk = (node: DomNode): boolean => {
    if (node.type === "text") {
      chunks.push(node.data ?? "");
      seen += squish(node.data).length;
      return seen >= min;
    }
    if (skipTags?.has(node.name ?? "")) return false;
    return (node.children ?? []).some(walk);
  };
  walk(root);
  return squish(chunks.join(""));
};

const TEXT_MAX = 120;
const HREF_MAX = 160;

// Skip Tailwind-style idents that need CSS escaping; the structural path covers them.
const CSS_IDENT = /^[A-Za-z_-][\w-]*$/;

const SKIP_ANCESTORS =
  "script, style, noscript, template, head, svg, [hidden], [aria-hidden='true'], [style*='display:none'], [style*='display: none'], [style*='visibility:hidden'], [style*='visibility: hidden']";

const isSkippable = ($: Api, el: El): boolean =>
  $el($, el).closest(SKIP_ANCESTORS).length > 0;

const classList = (el: El): string[] =>
  (el.attribs?.class || "").split(/\s+/).filter(Boolean);

const attrSelector = (tag: string, name: string, value: string): string =>
  `${tag}[${name}="${value}"]`;

const isSelectorAttr = (name: string, value: string): boolean =>
  CSS_IDENT.test(name) && isPreferredAttr(name, value);

// Built in one pass so selector uniqueness is a lookup. A selector-engine
// query per candidate scans the whole document each time, which took seconds
// on large pages.
type DocIndex = {
  order: Map<El, number>;
  // Elements in document order, keyed by the selector that matches them:
  // `tag`, `#id`, `tag.class`, `tag[name="value"]`.
  els: Map<string, El[]>;
};

const buildIndex = ($: Api): DocIndex => {
  const index: DocIndex = { order: new Map(), els: new Map() };
  const add = (key: string, el: El) => {
    const list = index.els.get(key);
    if (list) list.push(el);
    else index.els.set(key, [el]);
  };
  const nodes: unknown[] = $("*").toArray();
  nodes.forEach((node, i) => {
    if (!isEl(node)) return;
    index.order.set(node, i);
    const tag = tagOf(node);
    add(tag, node);
    for (const [name, value] of Object.entries(node.attribs ?? {})) {
      if (name === "id") add(`#${value}`, node);
      else if (isSelectorAttr(name, value)) {
        add(attrSelector(tag, name, value), node);
      }
    }
    for (const c of new Set(classList(node))) add(`${tag}.${c}`, node);
  });
  return index;
};

type SelectorCtx = { $: Api; cache: Map<El, string>; index: DocIndex };

const matches = (index: DocIndex, key: string): El[] =>
  index.els.get(key) ?? [];

const isUnique = (ctx: SelectorCtx, key: string): boolean =>
  matches(ctx.index, key).length === 1;

// `tag.a.b` — walk the rarest class's elements, stopping at a second match.
const isUniqueByClasses = (
  ctx: SelectorCtx,
  tag: string,
  classes: string[],
): boolean => {
  const rarest = classes
    .map((c) => matches(ctx.index, `${tag}.${c}`))
    .reduce((a, b) => (b.length < a.length ? b : a));
  let found = 0;
  for (const node of rarest) {
    const have = classList(node);
    if (classes.every((c) => have.includes(c)) && ++found > 1) return false;
  }
  return found === 1;
};

const stableClasses = (el: El): string[] =>
  classList(el)
    .filter((c) => CSS_IDENT.test(c) && !isHashedClass(c))
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
    isUnique(ctx, `#${id}`)
  ) {
    selector = `#${id}`;
  }

  if (!selector) {
    let tried = 0;
    for (const [name, value] of Object.entries(el.attribs ?? {})) {
      if (tried >= 3) break;
      if (name === "id" || !isSelectorAttr(name, value)) continue;
      if (/["\\\n]/.test(value)) continue;
      tried++;
      const candidate = attrSelector(tag, name, value);
      if (isUnique(ctx, candidate)) {
        selector = candidate;
        break;
      }
    }
  }

  const classes = stableClasses(el);
  if (!selector && classes.length) {
    if (isUniqueByClasses(ctx, tag, classes)) {
      selector = `${tag}.${classes.join(".")}`;
    }
  }

  if (!selector && SINGLETON_TAGS.has(tag) && isUnique(ctx, tag)) {
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

  // The stem comes from this element's own class, so the selector stays unique.
  const stem = bestStemForClass(el.attribs?.class || "");
  if (stem) selector = `${selector}[class*="${stem}"]`;

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

const collectStructural = (index: DocIndex): DomDigest["structural"] => {
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
    if (matches(index, l.tag).length > 0) out.push(l);
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
  const explicit =
    id && matches(ctx.index, "label").find((l) => l.attribs?.for === id);
  if (explicit) {
    return truncate(squish($el(ctx.$, explicit).text()), TEXT_MAX);
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

  // Document order and nearest visible siblings: the page outline,
  // describeContainer and sibling moves all need them.
  const siblingSelector = (el: El, dir: "prev" | "next") => {
    for (let node = el[dir]; node; node = node[dir]) {
      if (isEl(node) && !$el(ctx.$, node).is(SKIP_ANCESTORS)) {
        return buildSelector(ctx, node);
      }
    }
    return undefined;
  };

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
    const label = leadingText(el, 80).slice(0, 80) || undefined;
    const prevSiblingSelector = siblingSelector(el, "prev");
    const nextSiblingSelector = siblingSelector(el, "next");

    nodes.push({
      selector,
      ...(parentSelector ? { parentSelector } : {}),
      tag: tagOf(el),
      ...(el.attribs?.id ? { id: el.attribs.id } : {}),
      ...(classes.length ? { classes } : {}),
      ...(el.attribs?.role ? { role: el.attribs.role } : {}),
      ...(label ? { label } : {}),
      docOrder: ctx.index.order.get(el) ?? 0,
      ...(prevSiblingSelector ? { prevSiblingSelector } : {}),
      ...(nextSiblingSelector ? { nextSiblingSelector } : {}),
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

const NON_VISIBLE_TEXT_TAGS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
]);

const hasEnoughBodyText = (index: DocIndex): boolean =>
  matches(index, "body").some(
    (body) =>
      leadingText(body, MIN_BODY_TEXT, NON_VISIBLE_TEXT_TAGS).length >=
      MIN_BODY_TEXT,
  );

const hasEmptySpaRoot = (index: DocIndex): boolean =>
  SPA_ROOT_IDS.some((id) => {
    const mounts = matches(index, `#${id}`);
    return (
      mounts.length > 0 &&
      mounts.every((mount) => !(mount.children ?? []).some(isEl))
    );
  });

const catalogEntryCount = (digest: DomDigest): number =>
  digest.headings.length +
  digest.buttons.length +
  digest.links.length +
  digest.inputs.length +
  digest.images.length;

// Hybrid pages that SSR chrome but CSR the body still slip through — nothing
// short of a headless browser detects that.
const looksLikeThinShell = (index: DocIndex): boolean =>
  !hasEnoughBodyText(index) || hasEmptySpaRoot(index);

// Editor URLs come from a live browser tab, so the query string can carry a
// session, reset, or preview token. Logs keep the origin and path only.
const redactUrl = (raw: string): string => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "(unparseable)";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return url.protocol;
  return url.origin + url.pathname;
};

export const buildDigestFromEditorUrl = async (
  editorUrl: string,
): Promise<DomDigest | null> => {
  const url = parseFetchableEditorUrl(editorUrl);
  if (!url) {
    logger.info(
      { url: redactUrl(editorUrl) },
      "[visual-editor-ai] editorUrl is not fetchable; skipping server digest",
    );
    return null;
  }

  try {
    const page = await fetchPageHtml(url);
    if (!page) {
      logger.info(
        { url: redactUrl(url.href) },
        "[visual-editor-ai] page fetch did not yield a usable 200 HTML response; skipping server digest",
      );
      return null;
    }

    const $ = cheerio.load(page.html);
    const index = buildIndex($);
    if (looksLikeThinShell(index)) {
      logger.info(
        { url: redactUrl(url.href) },
        "[visual-editor-ai] fetched HTML looks client-rendered or too thin; skipping server digest",
      );
      return null;
    }

    const ctx: SelectorCtx = { $, cache: new Map(), index };
    const buttons = collectButtons(ctx);
    const digest: DomDigest = {
      url: page.url.href,
      title: squish($("title").first().text()),
      structural: collectStructural(index),
      headings: collectHeadings(ctx),
      buttons,
      links: collectLinks(ctx, new Set(buttons.map((b) => b.selector))),
      inputs: collectInputs(ctx),
      images: collectImages(ctx),
      pageStructure: collectStructureSnapshot(ctx),
    };

    if (catalogEntryCount(digest) < MIN_CATALOG_ENTRIES) {
      logger.info(
        { url: redactUrl(url.href) },
        "[visual-editor-ai] fetched HTML looks client-rendered or too thin; skipping server digest",
      );
      return null;
    }

    return digest;
  } catch (e) {
    logger.info(
      { err: e, url: redactUrl(url.href) },
      "[visual-editor-ai] server digest build failed; continuing without a digest",
    );
    return null;
  }
};
