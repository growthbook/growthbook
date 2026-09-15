// Mid-depth humanization layer for visual editor DOM mutations. The
// experiment-page "Values" redesign leads each row with a plain-English
// verb + title (e.g. "Tightened heading spacing"), a one-line `human`
// description, and a compact `after` chip — derived purely from the
// mutation data we already store. No fancy NLP; just classification +
// rule-based phrasing. See design_handoff_experiment_values 2/README.md.

import type { VisualChange } from "shared/types/visual-changeset";

export type ChangeType = "spacing" | "image" | "style" | "text" | "css";

export type Humanized = {
  type: ChangeType;
  verb: string;
  title: string;
  human: string;
  // Optional content for the small "after" chip on the right of each
  // change row. We only populate this for text-content edits (html,
  // href) because those benefit from an at-a-glance preview of the
  // new value. Everything else (spacing TRBL summaries, image
  // filenames, color/border tokens, line counts) is either cryptic
  // out of context or already visible in the code disclosure, so we
  // omit it to keep the row scannable.
  after?: string;
  // The selector to render in the inline chip. For global CSS/JS we
  // surface "Global" instead of the actual element selector.
  selectorLabel: string;
  // Raw lines to show in the per-row CSS disclosure. For style
  // mutations this is the declaration list, one per line; for src/href
  // it's the value; for "remove" actions a "{attr} (removed)" note.
  rawLines: string[];
  // Optional preview URL for image-src mutations — set only when the
  // raw value is an absolute http(s) URL or a data URL (relative URLs
  // resolve against the GrowthBook app origin, which would 404). The
  // ChangeRow renders this as a thumbnail in the expanded code panel.
  imageUrl?: string;
};

// Synthetic mutation shape used to represent a variation-level CSS or
// JS block in the same change list as DOM mutations — keeps the render
// loop uniform (the design treats "Added custom CSS" as just another
// row at the end of the variation).
type DomMutationLike = VisualChange["domMutations"][number];

export type GlobalBlock =
  | { kind: "css"; value: string }
  | { kind: "js"; value: string };

// Walk a style declaration string into property -> value pairs (very
// loose; tolerates trailing semicolons and !important).
function parseStyleDecls(
  styleText: string,
): Array<{ prop: string; value: string; important: boolean }> {
  const out: Array<{ prop: string; value: string; important: boolean }> = [];
  for (const decl of styleText.split(/;\s*/)) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    const i = trimmed.indexOf(":");
    if (i <= 0) continue;
    const prop = trimmed.slice(0, i).trim().toLowerCase();
    let value = trimmed.slice(i + 1).trim();
    let important = false;
    const m = value.match(/!\s*important\s*$/i);
    if (m) {
      important = true;
      value = value.slice(0, m.index).trim();
    }
    if (prop && value) out.push({ prop, value, important });
  }
  return out;
}

const SPACING_PROPS = new Set([
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "row-gap",
  "column-gap",
]);

const VISUAL_PROPS = new Set([
  "color",
  "background",
  "background-color",
  "background-image",
  "border",
  "border-color",
  "border-width",
  "border-style",
  "border-radius",
  "box-shadow",
  "font",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "opacity",
  "text-decoration",
  "text-transform",
]);

// Map a CSS selector to a human noun describing the element. Walks a
// small allowlist of common element classes ("hero", "heading", "btn",
// etc.) and returns the first match — falls back to "element" when
// nothing recognizable is found.
function selectorNoun(selector: string): string {
  const s = selector.toLowerCase();
  // Tag-name based first.
  if (/(^|[\s>+~])img(?:[.[:]|$)/.test(s)) return "image";
  if (/(^|[\s>+~])a(?:[.[:]|$)/.test(s)) return "link";
  if (/(^|[\s>+~])h1(?:[.[:]|$)/.test(s)) return "headline";
  if (/(^|[\s>+~])(h2|h3|h4|h5|h6)(?:[.[:]|$)/.test(s)) return "heading";
  if (/(^|[\s>+~])button(?:[.[:]|$)/.test(s)) return "button";
  if (/(^|[\s>+~])nav(?:[.[:]|$)/.test(s)) return "navigation";
  if (/(^|[\s>+~])section(?:[.[:]|$)/.test(s)) return "section";
  if (/(^|[\s>+~])footer(?:[.[:]|$)/.test(s)) return "footer";
  if (/(^|[\s>+~])header(?:[.[:]|$)/.test(s)) return "header";
  // Class hints — first match wins.
  if (/\bhero\b/.test(s)) return "hero";
  if (/(heading|headline|title)/.test(s)) return "heading";
  if (/(image|img|photo|picture)/.test(s)) return "image";
  if (/(button|\bbtn\b|\bcta\b)/.test(s)) return "button";
  if (/\bcard\b/.test(s)) return "card";
  if (/(nav|menu)/.test(s)) return "navigation";
  if (/footer/.test(s)) return "footer";
  if (/header/.test(s)) return "header";
  if (/(content|section|block)/.test(s)) return "section";
  return "element";
}

// Truncate a string to ~maxLen, ellipsizing the middle. Used in the
// `after` chip's text-content preview for html / href edits.
function compactStr(s: string, maxLen = 32): string {
  if (s.length <= maxLen) return s;
  const head = Math.ceil((maxLen - 1) * 0.6);
  const tail = Math.floor((maxLen - 1) * 0.4);
  return s.slice(0, head) + "…" + s.slice(-tail);
}

export function humanizeMutation(m: DomMutationLike): Humanized {
  const attr = (m.attribute || "").toLowerCase();
  const noun = selectorNoun(m.selector || "");
  const rawValue = m.value ?? "";

  // -- HTML / inner text --
  if (attr === "html") {
    const trimmed = rawValue.replace(/\s+/g, " ").trim();
    return {
      type: "text",
      verb: m.action === "remove" ? "Removed" : "Edited",
      title: `${noun === "element" ? "text" : noun} copy`,
      human:
        m.action === "remove"
          ? `Cleared the ${noun} text`
          : `Rewrote the ${noun} text`,
      after: trimmed ? `“${compactStr(trimmed, 28)}”` : "",
      selectorLabel: m.selector,
      rawLines: trimmed ? [trimmed] : ["(empty)"],
    };
  }

  // -- Image src --
  if (attr === "src") {
    // Only surface a preview URL when it'll actually load from the
    // GrowthBook app: absolute http(s) or data: URLs. Protocol-relative
    // (`//cdn.example.com/...`) is also fine — Safari and Chrome both
    // resolve it against the current page's scheme.
    const isPreviewable =
      /^(https?:)?\/\//i.test(rawValue) || /^data:image\//i.test(rawValue);
    // Avoid "the image image" when the element itself is an <img> (noun
    // resolves to "image"), and drop the vague "element" fallback so we
    // don't read "the element image". A descriptive noun (e.g. "hero")
    // still reads naturally as "the hero image".
    const subject =
      noun === "image" || noun === "element" ? "image" : `${noun} image`;
    return {
      type: "image",
      verb: m.action === "remove" ? "Removed" : "Swapped",
      title: "image source",
      human:
        m.action === "remove"
          ? `Removed the ${subject}`
          : `Replaced the ${subject}`,
      // No after chip — the new image is shown as a thumbnail in the
      // code disclosure, and the filename is in the raw `src:` line.
      selectorLabel: m.selector,
      rawLines: rawValue ? ["src: " + rawValue] : ["src (removed)"],
      ...(isPreviewable ? { imageUrl: rawValue } : {}),
    };
  }

  // -- Responsive srcset --
  // Visual-editor-generated srcset removals are almost always a
  // companion to a separate `src` mutation — without clearing srcset
  // the browser keeps picking the original image from the responsive
  // candidates and the swap silently doesn't show. We say that
  // explicitly so the row doesn't read as a stray removal.
  if (attr === "srcset") {
    return {
      type: "image",
      verb: "Removed",
      title: "responsive srcset",
      human: `Required so the new image isn't overridden by responsive sources`,
      selectorLabel: m.selector,
      rawLines: ["srcset (removed)"],
    };
  }

  // -- Link href --
  if (attr === "href") {
    return {
      type: "text",
      verb: m.action === "remove" ? "Removed" : "Updated",
      title: "link target",
      human:
        m.action === "remove"
          ? `Removed the ${noun} link`
          : `Updated the ${noun} link`,
      after: rawValue ? compactStr(rawValue, 28) : "removed",
      selectorLabel: m.selector,
      rawLines: rawValue ? ["href: " + rawValue] : ["href (removed)"],
    };
  }

  // -- Position (drag/drop move) --
  if (attr === "position") {
    return {
      type: "spacing",
      verb: "Moved",
      title: `${noun}`,
      human: m.parentSelector
        ? `Moved to ${m.parentSelector}${
            m.insertBeforeSelector ? ` before ${m.insertBeforeSelector}` : ""
          }`
        : `Repositioned ${noun}`,
      selectorLabel: m.selector,
      rawLines: [
        m.parentSelector ? `parent: ${m.parentSelector}` : "parent: (unset)",
        m.insertBeforeSelector
          ? `insertBefore: ${m.insertBeforeSelector}`
          : "insertBefore: (end)",
      ],
    };
  }

  // -- Class changes --
  if (attr === "class" || attr === "classname") {
    const verb =
      m.action === "remove"
        ? "Removed"
        : m.action === "append"
          ? "Added"
          : "Set";
    return {
      type: "style",
      verb,
      title: `${noun} classes`,
      human:
        m.action === "remove"
          ? `Removed CSS classes from the ${noun}`
          : m.action === "append"
            ? `Added CSS classes to the ${noun}`
            : `Replaced the ${noun} class list`,
      selectorLabel: m.selector,
      rawLines: rawValue ? [rawValue] : ["(empty)"],
    };
  }

  // -- Style attribute (the rich path) --
  if (attr === "style") {
    const decls = parseStyleDecls(rawValue);
    const props = decls.map((d) => d.prop);
    const spacingCount = props.filter((p) => SPACING_PROPS.has(p)).length;
    const visualCount = props.filter((p) => VISUAL_PROPS.has(p)).length;
    const isSpacing = spacingCount > 0 && visualCount === 0;
    const type: ChangeType = isSpacing ? "spacing" : "style";
    const rawLines = decls.map(
      (d) => `${d.prop}: ${d.value}${d.important ? " !important" : ""};`,
    );

    if (type === "spacing") {
      // Verb heuristics
      const valuesAllZero = decls.every((d) =>
        /^0(?:px|em|rem|%)?$/.test(d.value),
      );
      const hasAuto = decls.some((d) => /\bauto\b/i.test(d.value));
      const verb = valuesAllZero
        ? "Tightened"
        : hasAuto
          ? "Centered"
          : "Adjusted";
      // Human description
      const onlyHorizontal = decls.every((d) =>
        /(padding|margin)-(left|right)$/.test(d.prop),
      );
      const onlyVertical = decls.every((d) =>
        /(padding|margin)-(top|bottom)$/.test(d.prop),
      );
      const propsTouched = new Set(
        decls
          .map((d) => d.prop.replace(/-(top|right|bottom|left)$/, ""))
          .filter((p) => p === "padding" || p === "margin" || p === "gap"),
      );
      const propsLabel = Array.from(propsTouched).join(" & ");
      let human: string;
      if (valuesAllZero) {
        human = onlyHorizontal
          ? `Removed horizontal ${propsLabel || "spacing"}`
          : onlyVertical
            ? `Removed vertical ${propsLabel || "spacing"}`
            : `Removed ${propsLabel || "spacing"}`;
      } else if (hasAuto) {
        human = "Auto margins for centering";
      } else {
        human = `Adjusted ${propsLabel || "spacing"}`;
      }
      return {
        type,
        verb,
        title: `${noun} spacing`,
        human,
        selectorLabel: m.selector,
        rawLines,
      };
    }

    // Visual style branch
    const hasBorder = props.some((p) => p.startsWith("border"));
    const hasShadow = props.some((p) => p === "box-shadow");
    const hasColor = props.some((p) => p === "color");
    const hasBg = props.some((p) => p.startsWith("background"));
    const hasFont = props.some(
      (p) => p.startsWith("font") || p === "line-height",
    );
    const verb = "Restyled";
    const facets: string[] = [];
    if (hasBorder) facets.push("border");
    if (hasShadow) facets.push("shadow");
    if (hasBg) facets.push("background");
    if (hasColor) facets.push("color");
    if (hasFont) facets.push("typography");
    const human = facets.length
      ? `Updated ${facets.join(", ")}`
      : `Updated styles`;
    return {
      type,
      verb,
      title: noun,
      human,
      selectorLabel: m.selector,
      rawLines,
    };
  }

  // -- Generic attribute fallback --
  return {
    type: "style",
    verb: m.action === "remove" ? "Removed" : "Set",
    title: `${attr}`,
    human:
      m.action === "remove"
        ? `Removed the ${attr} attribute`
        : `Set the ${attr} attribute`,
    selectorLabel: m.selector,
    rawLines: rawValue ? [`${attr}: ${rawValue}`] : [`${attr} (removed)`],
  };
}

// Variation-level CSS / JS blocks share the same row layout as DOM
// mutations; this helper produces the equivalent Humanized for them so
// the render loop can stay uniform.
export function humanizeGlobalBlock(block: GlobalBlock): Humanized {
  if (block.kind === "css") {
    return {
      type: "css",
      verb: "Added",
      title: "custom CSS",
      human: "Page-level custom CSS",
      selectorLabel: "Global",
      rawLines: block.value.split("\n"),
    };
  }
  return {
    type: "css",
    verb: "Added",
    title: "custom JavaScript",
    human: "Page-level custom JS",
    selectorLabel: "Global",
    rawLines: block.value.split("\n"),
  };
}
