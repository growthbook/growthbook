import path from "path";
import fs from "fs";
import * as url from "url";
import { load, dump } from "js-yaml";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

async function run() {
  const specPath = path.join(__dirname, "../api/openapi/openapi.yaml");
  const api = load(fs.readFileSync(specPath));

  // Group all existing tags under "Endpoints"
  // This is to avoid confusion in the docs when we programmatically add a section for all the models
  api["x-tagGroups"] = api["x-tagGroups"] || [];
  api["x-tagGroups"].push({
    name: "Endpoints",
    tags: api.tags.map((tag) => tag.name),
  });

  // Before generating types, programmatically add all models to the spec
  const models = fs
    .readdirSync(path.join(__dirname, "../api/openapi/schemas"))
    .filter((fileName) => !fileName.includes("index"))
    .map((fileName) => fileName.replace(".yaml", ""));

  // Add all model schemas to the tags
  models.forEach((model) => {
    api.tags.push({
      name: `${model}_model`,
      "x-displayName": model,
      description: `<SchemaDefinition schemaRef="#/components/schemas/${model}" />`,
    });
  });

  // Add all models to a new tag group to group them in the docs under "Models"
  api["x-tagGroups"].push({
    name: "Models",
    tags: models.map((model) => model + "_model"),
  });

  const output = dump(api);
  fs.writeFileSync(
    path.join(__dirname, "../api/openapi/openapi.tmp.yaml"),
    output
  );
}

run()
  .then(() =>
    console.log("Generated tag groups and models for OpenAPI base file")
  )
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
