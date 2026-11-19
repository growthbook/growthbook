import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { assessReadiness, formatReadiness } from "./readiness";
import { specValidator } from "./spec";

const specPath =
  process.argv[2] ??
  path.join(__dirname, "..", "..", "back-end", "generated", "spec.yaml");
const spec = specValidator.parse(yaml.load(readFileSync(specPath, "utf8")));
console.log(formatReadiness(assessReadiness(spec)));
