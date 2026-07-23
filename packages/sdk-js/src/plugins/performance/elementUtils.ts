const SAFE_PROTOCOLS = ["http:", "https:"];
const RESERVED_DATA_GB_KEYS = new Set([
  "ignore",
  "ignore-clicks",
  "ignore-forms",
  "ignore-rage",
  "sensitive",
  "track",
]);
const MAX_TEXT_LEN = 80;
const MAX_STRING_LEN = 256;
const MAX_CLASSES = 10;

function lower(v: string | null | undefined): string {
  return String(v || "").toLowerCase();
}

function truncate(
  v: string | null | undefined,
  max = MAX_STRING_LEN,
): string | undefined {
  if (v == null) return undefined;
  const s = String(v);
  return s.length <= max ? s : s.slice(0, max - 1) + "\u2026";
}

function cssEscape(v: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function")
    return CSS.escape(v);
  return v.replace(/['"\\]/g, "\\$&");
}

export type ElementPropertyOptions = {
  collectText?: boolean;
  sensitiveSelector?: string;
  maxSelectorDepth?: number;
};

export type ElementProperties = Record<string, unknown>;

function getAncestorChain(el: Element, maxDepth = 5): Element[] {
  const chain: Element[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (
    cur &&
    cur.nodeType === 1 &&
    cur !== document.documentElement &&
    depth < maxDepth
  ) {
    chain.unshift(cur);
    cur = cur.parentElement;
    depth++;
  }
  return chain;
}

export function buildSelector(el: Element, maxDepth = 5): string | undefined {
  const chain = getAncestorChain(el, maxDepth).filter(
    (e) => e !== document.body && e !== document.documentElement,
  );
  if (!chain.length) return undefined;

  let startIndex = Math.max(0, chain.length - 5);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (
      chain[i].getAttribute("id") ||
      chain[i].getAttribute("data-testid") ||
      chain[i].getAttribute("data-test-id")
    ) {
      startIndex = i;
      break;
    }
  }

  const selected = chain.slice(startIndex).slice(-5);
  const parts = selected.map((e) => {
    let part = lower(e.tagName);
    const id = e.getAttribute("id");
    if (id) return part + "#" + cssEscape(id);
    const testId =
      e.getAttribute("data-testid") || e.getAttribute("data-test-id");
    if (testId) return part + "[data-testid='" + cssEscape(testId) + "']";
    const role = e.getAttribute("role");
    if (role) part += "[role='" + cssEscape(role) + "']";
    return part;
  });
  return truncate(parts.join(" > "), 200);
}

export function getDataGbAttributes(
  el: Element,
  sensitiveSelector?: string,
): Record<string, string | undefined> {
  const chain = getAncestorChain(el);
  if (sensitiveSelector && chain.some((e) => e.matches(sensitiveSelector)))
    return {};

  const result: Record<string, string | undefined> = {};
  for (const e of chain) {
    for (const attr of Array.from(e.attributes || [])) {
      if (!attr.name.startsWith("data-gb-")) continue;
      const rawKey = attr.name.slice("data-gb-".length);
      if (RESERVED_DATA_GB_KEYS.has(rawKey)) continue;
      result["data_" + rawKey.replace(/-/g, "_").toLowerCase()] = truncate(
        attr.value,
      );
    }
  }
  return result;
}

function getSafeElementText(
  el: Element,
  sensitiveSelector?: string,
): string | undefined {
  if (el.matches("input, textarea, select")) return undefined;
  if (sensitiveSelector && el.closest(sensitiveSelector)) return undefined;
  const text = ((el as HTMLElement).innerText || el.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(text, MAX_TEXT_LEN);
}

function getHrefProperties(el: Element): Record<string, unknown> {
  const anchor = el.closest("a");
  const href = el.getAttribute("href") || anchor?.getAttribute("href");
  if (!href) return {};
  try {
    const parsed = new URL(href, location.href);
    if (!SAFE_PROTOCOLS.includes(parsed.protocol)) return {};
    return cleanProperties({
      element_href: truncate(parsed.origin + parsed.pathname),
      element_href_host: truncate(parsed.host),
      element_href_path: truncate(parsed.pathname),
      element_href_external: parsed.host !== location.host,
    });
  } catch {
    return { element_href: truncate(href) };
  }
}

export function getClickEventName(el: Element): string {
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1) {
    if (cur.hasAttribute("data-gb-track")) {
      const v = cur.getAttribute("data-gb-track");
      if (v && v !== "true") return v;
    }
    cur = cur.parentElement;
  }
  if (el.matches("a, [role='link']")) return "link_click";
  if (
    el.matches(
      "button, input[type='button'], input[type='submit'], input[type='reset'], [role='button']",
    )
  )
    return "button_click";
  return "element_click";
}

export function getFormActionProperties(
  form: HTMLFormElement,
): Record<string, unknown> {
  const action = form.getAttribute("action");
  if (!action) return {};
  try {
    const parsed = new URL(action, location.href);
    return {
      form_action_host: truncate(parsed.host),
      form_action_path: truncate(parsed.pathname),
    };
  } catch {
    return { form_action: truncate(action) };
  }
}

export function getElementProperties(
  el: Element,
  opts: ElementPropertyOptions = {},
): ElementProperties {
  const sensitive = opts.sensitiveSelector
    ? !!el.closest(opts.sensitiveSelector)
    : false;

  return cleanProperties({
    element_tag: lower(el.tagName),
    element_id: truncate(el.getAttribute("id")),
    element_role: truncate(el.getAttribute("role")),
    element_type: truncate(el.getAttribute("type")),
    element_name: truncate(el.getAttribute("name")),
    element_classes:
      el.classList && el.classList.length > 0
        ? Array.from(el.classList)
            .filter(Boolean)
            .slice(0, MAX_CLASSES)
            .join(" ")
        : undefined,
    element_selector: buildSelector(el, opts.maxSelectorDepth ?? 5),
    element_text:
      !sensitive && opts.collectText !== false
        ? getSafeElementText(el, opts.sensitiveSelector)
        : undefined,
    ...getHrefProperties(el),
    ...getDataGbAttributes(el, opts.sensitiveSelector),
  });
}

export function cleanProperties(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "") continue;
    out[k] = typeof v === "string" ? truncate(v) : v;
  }
  return out;
}

export function shouldIgnore(
  el: Element | null,
  ignoreSelector?: string,
): boolean {
  if (!el || !ignoreSelector) return false;
  return !!el.closest(ignoreSelector);
}

export function resolveElement(target: EventTarget | null): Element | null {
  if (!target) return null;
  const node = target as Node;
  if (node.nodeType === 1) return node as Element;
  if (node.nodeType === 3 && node.parentElement) return node.parentElement;
  return null;
}
