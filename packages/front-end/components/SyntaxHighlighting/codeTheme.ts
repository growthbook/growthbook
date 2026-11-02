import { CSSProperties } from "react";
import { ghcolors } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { darkDeclaration } from "./darkColors";

type CodeTheme = typeof ghcolors;

const CODE_FONT_WEIGHT = 400;
export const CODE_FONT_SIZE = "0.8rem";
export const CODE_LINE_HEIGHT = 1.5;
const CODE_FONT_FAMILY = "var(--code-font-family)";

// The palette names its own fonts, which fall back to Courier where they're
// missing; code uses the app's font and type scale instead.
function withAppType(theme: CodeTheme): CodeTheme {
  return {
    ...theme,
    'code[class*="language-"]': {
      ...theme['code[class*="language-"]'],
      fontFamily: CODE_FONT_FAMILY,
      fontSize: CODE_FONT_SIZE,
      lineHeight: CODE_LINE_HEIGHT,
      fontWeight: CODE_FONT_WEIGHT,
    },
    'pre[class*="language-"]': {
      ...theme['pre[class*="language-"]'],
      fontFamily: CODE_FONT_FAMILY,
    },
  };
}

const COLOR_PROPERTIES = [
  "color",
  "background",
  "backgroundColor",
  "border",
] as const;

function toDark(style: CSSProperties): CSSProperties {
  const dark = { ...style };
  for (const property of COLOR_PROPERTIES) {
    const value = dark[property];
    if (typeof value === "string")
      dark[property] = darkDeclaration(property, value);
  }
  return dark;
}

const LIGHT_THEME = withAppType(ghcolors);
// Dark is light inverted, not a palette of its own.
const DARK_THEME: CodeTheme = Object.fromEntries(
  Object.entries(LIGHT_THEME).map(([selector, style]) => [
    selector,
    toDark(style),
  ]),
);

// The Prism palette code renders in. `inverted` flips it, for code shown on a
// surface of the opposite appearance (a tooltip).
export function getCodeTheme(
  appearance: "light" | "dark",
  inverted = false,
): CodeTheme {
  return (appearance === "light") !== inverted ? LIGHT_THEME : DARK_THEME;
}

// Ace's token classes for each Prism token type.
const ACE_TOKENS: Record<string, string[]> = {
  comment: [".ace_comment"],
  string: [".ace_string"],
  regex: [".ace_string.ace_regexp"],
  number: [".ace_constant.ace_numeric"],
  boolean: [".ace_constant.ace_language.ace_boolean"],
  keyword: [
    ".ace_keyword",
    ".ace_storage",
    ".ace_constant.ace_language:not(.ace_boolean)",
  ],
  operator: [".ace_keyword.ace_operator"],
  function: [".ace_support.ace_function", ".ace_entity.ace_name.ace_function"],
  builtin: [".ace_support.ace_type", ".ace_support.ace_constant"],
  "class-name": [".ace_support.ace_class", ".ace_entity.ace_name.ace_class"],
  tag: [".ace_meta.ace_tag"],
  "attr-name": [".ace_entity.ace_other.ace_attribute-name"],
  punctuation: [".ace_paren", ".ace_punctuation"],
  variable: [".ace_variable"],
};

// JSON's keys are Ace variables but Prism properties.
const ACE_JSON_TOKENS: Record<string, string[]> = {
  ...ACE_TOKENS,
  variable: [],
  property: [".ace_variable"],
};

// CSS that sets an Ace editor under `scope` in rendered code's type and colors.
export function getAceCodeCss(
  scope: string,
  theme: CodeTheme,
  language: string,
): string {
  const tokens = language === "json" ? ACE_JSON_TOKENS : ACE_TOKENS;
  const base = theme['code[class*="language-"]']?.color;
  const rules = Object.entries(tokens).flatMap(([token, classes]) => {
    const color = theme[token]?.color;
    if (!color || !classes.length) return [];
    const selector = classes.map((c) => `${scope} ${c}`).join(", ");
    return [`${selector} { color: ${color}; }`];
  });
  return [
    `${scope} .ace_editor { font-family: ${CODE_FONT_FAMILY}; font-size-adjust: var(--code-font-x-height); line-height: ${CODE_LINE_HEIGHT}; }`,
    `${scope} .ace_content { font-weight: ${CODE_FONT_WEIGHT};${base ? ` color: ${base};` : ""} }`,
    ...rules,
  ].join("\n");
}
