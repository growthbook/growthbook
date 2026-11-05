import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { analyzeResource } from "./resource-model";
import { specValidator } from "./spec";
import { renderRegistry, renderResource } from "./terraform";

const [outDir, ...names] = process.argv.slice(2);
if (!outDir || !names.length) {
  console.error("Usage: terraform <provider dir> <resource>...");
  process.exit(1);
}

const specPath = path.join(
  __dirname,
  "..",
  "..",
  "back-end",
  "generated",
  "spec.yaml",
);
const spec = specValidator.parse(yaml.load(readFileSync(specPath, "utf8")));
const models = names.map((name) => analyzeResource(spec, name));
const files = new Map(
  models.map((model) => [
    `${model.name}_resource_gen.go`,
    renderResource(model),
  ]),
);
files.set("resources_gen.go", renderRegistry(models));

// Generated files are ours alone, so stale ones are removed.
for (const file of readdirSync(outDir)) {
  if (file.endsWith("_gen.go")) rmSync(path.join(outDir, file));
}
for (const [file, contents] of files) {
  writeFileSync(path.join(outDir, file), contents);
}
console.log(`Wrote ${files.size} files to ${outDir}`);
