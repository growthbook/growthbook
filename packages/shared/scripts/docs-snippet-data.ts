import fs from "node:fs";
import path from "node:path";
import { format } from "prettier";

export const docsSnippetsPath = path.resolve(
  path.dirname(process.argv[1]),
  "../../../docs/snippets",
);

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
 * Mintlify snippets cannot import data files, so generated data is written
 * into the `const <name> = {...}` literal of the snippet that renders it.
 */
export async function writeSnippetConst(
  snippet: string,
  name: string,
  value: unknown,
) {
  const file = path.join(docsSnippetsPath, snippet);
  const source = fs.readFileSync(file, "utf8");
  const declaration = `const ${name} = `;
  const declarationStart = source.indexOf(declaration);
  if (declarationStart === -1) {
    throw new Error(`${snippet} has no "${declaration}{...}" to replace`);
  }
  const objectStart = declarationStart + declaration.length;
  const objectEnd = findObjectEnd(source, objectStart);
  const indent = source.slice(
    source.lastIndexOf("\n", declarationStart) + 1,
    declarationStart,
  );

  const formatted = await format(
    `${declaration}${JSON.stringify(value, null, 2)};`,
    { parser: "babel" },
  );
  const literal = formatted
    .trim()
    .slice(declaration.length, -1)
    .split("\n")
    .map((line, i) => (i === 0 || line === "" ? line : indent + line))
    .join("\n");

  fs.writeFileSync(
    file,
    source.slice(0, objectStart) + literal + source.slice(objectEnd + 1),
  );
}
