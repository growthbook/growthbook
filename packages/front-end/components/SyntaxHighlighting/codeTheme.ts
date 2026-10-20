import {
  ghcolors,
  tomorrow,
} from "react-syntax-highlighter/dist/cjs/styles/prism";

export type CodeTheme = typeof ghcolors;

export const CODE_FONT_WEIGHT = 600;
export const CODE_LINE_HEIGHT = 1.5;

// The Prism palette code renders in. `inverted` flips it, for code shown on a
// surface of the opposite appearance (a tooltip).
export function getCodeTheme(
  appearance: "light" | "dark",
  inverted = false,
): CodeTheme {
  return (appearance === "light") !== inverted ? ghcolors : tomorrow;
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

// CSS that colors an Ace editor under `scope` like rendered code.
export function getAceColorCss(
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
  return [base ? `${scope} .ace_content { color: ${base}; }` : "", ...rules]
    .filter(Boolean)
    .join("\n");
}

// CSS that sets an Ace editor's type under `scope` like rendered code.
export function getAceTypeCss(scope: string, theme: CodeTheme): string {
  const fontFamily = theme['code[class*="language-"]']?.fontFamily;
  return [
    `${scope} .ace_editor { ${fontFamily ? `font-family: ${fontFamily}; ` : ""}line-height: ${CODE_LINE_HEIGHT}; }`,
    `${scope} .ace_content { font-weight: ${CODE_FONT_WEIGHT}; }`,
  ].join("\n");
}
