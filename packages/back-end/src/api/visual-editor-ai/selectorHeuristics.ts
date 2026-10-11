// Port of visual-editor/src/content_script/selectorHeuristics.ts (source of
// truth). Hashed classes rotate across deploys; recoverable stems are used
// as `[class*="stem"]` so a stale selector matches nothing, not the wrong node.

const RE_CSS_MODULE = /^[A-Za-z][\w-]*_[A-Za-z][\w-]*__([A-Za-z0-9_-]{4,})$/;
const RE_CSS_MODULE_SINGLE = /^([A-Za-z][\w-]*)_([A-Za-z0-9]{4,})$/;
const RE_EMOTION = /^css-[A-Za-z0-9_-]{4,}$/;
const RE_STYLED_COMPONENTS = /(^|__)sc-[A-Za-z0-9]{4,}$/;
const RE_STYLED_JSX = /^jsx-(?=[0-9a-f]*\d)[0-9a-f]{6,}$/i;

const looksLikeHash = (s: string): boolean =>
  /\d/.test(s) || (/[a-z]/.test(s) && /[A-Z]/.test(s));

const isPureHashClass = (name: string): boolean => {
  if (!/^[A-Za-z0-9]{8,}$/.test(name)) return false;
  if (!/[A-Za-z]/.test(name) || !/\d/.test(name)) return false;
  const digits = (name.match(/\d/g) || []).length;
  const mixedCase = /[a-z]/.test(name) && /[A-Z]/.test(name);
  return digits >= 2 || mixedCase;
};

export const isHashedClass = (className: string): boolean => {
  if (!className) return false;
  const cssMod = RE_CSS_MODULE.exec(className);
  if (cssMod && looksLikeHash(cssMod[1])) return true;
  if (RE_EMOTION.test(className)) return true;
  if (RE_STYLED_COMPONENTS.test(className)) return true;
  if (RE_STYLED_JSX.test(className)) return true;
  if (isPureHashClass(className)) return true;
  const single = RE_CSS_MODULE_SINGLE.exec(className);
  if (single && looksLikeHash(single[2])) return true;
  return false;
};

const extractClassStem = (className: string): string | null => {
  const cssMod = /^[A-Za-z][\w-]*_([A-Za-z][\w-]+)__([A-Za-z0-9_-]{4,})$/.exec(
    className,
  );
  if (cssMod && looksLikeHash(cssMod[2])) return cssMod[1];

  const sc = /^([A-Za-z][\w-]+)__sc-[A-Za-z0-9]{4,}$/.exec(className);
  if (sc) return sc[1];

  const single = RE_CSS_MODULE_SINGLE.exec(className);
  if (single && looksLikeHash(single[2])) return single[1];

  return null;
};

const GENERIC_STEMS: ReadonlySet<string> = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "body",
  "container",
  "wrapper",
  "inner",
  "outer",
  "root",
  "item",
  "row",
  "col",
  "cell",
  "block",
  "section",
]);

export const bestStemForClass = (className: string): string | null => {
  const stems = className
    .split(/\s+/)
    .map(extractClassStem)
    .filter(
      (stem): stem is string =>
        !!stem && stem.length >= 4 && !GENERIC_STEMS.has(stem.toLowerCase()),
    );
  if (!stems.length) return null;
  return stems.sort((a, b) => b.length - a.length)[0];
};

const PREFERRED_ATTRS: ReadonlySet<string> = new Set([
  "id",
  "name",
  "type",
  "role",
  "href",
  "alt",
  "title",
  "itemprop",
  "itemtype",
]);
const PREFERRED_ATTR_PREFIXES = ["data-", "aria-"];
const NOISE_ATTRS: ReadonlySet<string> = new Set([
  "data-reactid",
  "data-radix-collection-item",
  "data-state",
  "data-orientation",
]);
const NOISE_ATTR_PREFIXES = [
  "data-react",
  "data-v-",
  "data-svelte-",
  "data-n-",
  "data-wf-",
];

export const isPreferredAttr = (name: string, value: string): boolean => {
  if (!value) return false;
  if (value.length > 80) return false;
  if (NOISE_ATTRS.has(name)) return false;
  if (NOISE_ATTR_PREFIXES.some((p) => name.startsWith(p))) return false;
  if (PREFERRED_ATTRS.has(name)) return true;
  return PREFERRED_ATTR_PREFIXES.some((p) => name.startsWith(p));
};
