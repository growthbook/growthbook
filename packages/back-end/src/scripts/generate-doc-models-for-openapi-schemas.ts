import path from "path";
import fs from "fs";
import { load, dump } from "js-yaml";

type ApiTag = {
  name: string;
  "x-displayName": string;
  description: string;
};

type ApiShape = {
  tags: ApiTag[];
  "x-tagGroups"?: Array<{
    name: string;
    tags: string[];
  }>;
};

function isValidTag(tag: unknown): tag is ApiTag {
  if (!tag || typeof tag !== "object") return false;
  if (!("name" in tag) || typeof tag.name !== "string") return false;
  if (!("x-displayName" in tag) || typeof tag["x-displayName"] !== "string")
    return false;
  if (!("description" in tag) || typeof tag.description !== "string")
    return false;
  return true;
}

function isValidApi(
  loadedApiDoc: string | number | object | null | undefined,
): loadedApiDoc is ApiShape {
  if (!loadedApiDoc || typeof loadedApiDoc !== "object") return false;
  if (!("tags" in loadedApiDoc) || !Array.isArray(loadedApiDoc.tags)) {
    return false;
  }
  if (loadedApiDoc.tags.some((tag) => !isValidTag(tag))) return false;
  return true;
}

async function run() {
  const specPath = path.join(__dirname, "../api/openapi/openapi.yaml");
  const api = load(fs.readFileSync(specPath, "utf-8"));

  if (!isValidApi(api)) {
    throw new Error("Failed to validate openapi.yaml");
  }
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
    output,
  );
}

run()
  .then(() =>
    console.log("Generated tag groups and models for OpenAPI base file"),
  )
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
