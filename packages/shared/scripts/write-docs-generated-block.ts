import fs from "node:fs";
import prettier from "prettier";

// Mintlify .jsx snippets can't import other files, and Mintlify injects every
// .js file under docs/ as a global <script>. So generated data is spliced into
// the component itself, between `// BEGIN GENERATED <name>` and
// `// END GENERATED <name>` comments.
export async function writeDocsGeneratedBlock(
  target: string,
  name: string,
  declaration: string,
) {
  const begin = `// BEGIN GENERATED ${name}`;
  const end = `// END GENERATED ${name}`;
  const source = fs.readFileSync(target, "utf8");
  const beginAt = source.indexOf(begin);
  const endAt = source.indexOf(end);
  if (beginAt === -1 || endAt < beginAt) {
    throw new Error(`${target} is missing the "${begin}" / "${end}" markers`);
  }
  const blockStart = source.indexOf("\n", beginAt) + 1;
  const updated =
    source.slice(0, blockStart) + declaration + "\n" + source.slice(endAt);
  const options = await prettier.resolveConfig(target);
  fs.writeFileSync(
    target,
    await prettier.format(updated, { ...options, filepath: target }),
  );
}
