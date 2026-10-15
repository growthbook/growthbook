import fs from "node:fs";
import path from "node:path";
import * as babelPlugin from "prettier/plugins/babel";
import * as estreePlugin from "prettier/plugins/estree";
import { format } from "prettier/standalone";

function findObjectEnd(source: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}" && --depth === 0) {
      return i;
    }
  }
  throw new Error("Unterminated object literal");
}

/**
 * Replace the `const <name> = {...}` literal in `source` with `value`,
 * formatted with prettier and indented like the declaration.
 */
export async function replaceSnippetConst(
  source: string,
  name: string,
  value: unknown,
): Promise<string> {
  const declaration = `const ${name} = `;
  const declarationStart = source.indexOf(declaration);
  if (declarationStart === -1) {
    throw new Error(`No "${declaration}{...}" to replace`);
  }
  const objectStart = declarationStart + declaration.length;
  if (source[objectStart] !== "{") {
    throw new Error(`"${declaration}" is not followed by an object literal`);
  }
  const objectEnd = findObjectEnd(source, objectStart);
  const indent = source.slice(
    source.lastIndexOf("\n", declarationStart) + 1,
    declarationStart,
  );

  const formatted = await format(
    `${declaration}${JSON.stringify(value, null, 2)};`,
    { parser: "babel", plugins: [babelPlugin, estreePlugin] },
  );
  const literal = formatted
    .trim()
    .slice(declaration.length, -1)
    .split("\n")
    .map((line, i) => (i === 0 || line === "" ? line : indent + line))
    .join("\n");

  return source.slice(0, objectStart) + literal + source.slice(objectEnd + 1);
}

/**
 * Mintlify snippets cannot import data files, so generated data is written
 * into the `const <name> = {...}` literal of the snippet that renders it.
 */
export async function writeSnippetConst(
  snippet: string,
  name: string,
  value: unknown,
) {
  const file = path.resolve(
    path.dirname(process.argv[1]),
    "../../../docs/snippets",
    snippet,
  );
  const source = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, await replaceSnippetConst(source, name, value));
}
