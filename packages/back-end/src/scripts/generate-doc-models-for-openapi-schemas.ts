import path from "path";
import fs from "fs";
import { load, dump } from "js-yaml";
import { capitalizeFirstCharacter } from "shared/util";
import { z } from "zod";
import {
  API_MODELS,
  generateYamlForPath,
  getCrudConfig,
  getDefaultCrudActionSummary,
  HttpVerb,
  httpVerbs,
} from "back-end/src/api/ApiModel";

type ApiTag = {
  name: string;
  "x-displayName": string;
  description: string;
};
type PathRef = { $ref: string };
type PathDefinition = Record<string, unknown>;
type PathRecord = {
  [verb in HttpVerb]?: PathRef | PathDefinition;
};
type ApiPaths = PathRecord | PathRef;
type ApiShape = {
  tags: ApiTag[];
  paths: Record<string, ApiPaths>;
  components: {
    schemas: Record<string, object>;
  };
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
function isValidPathRecord(pathRecord: unknown): pathRecord is ApiPaths {
  if (!pathRecord || typeof pathRecord !== "object") return false;
  if (
    "$ref" in pathRecord &&
    typeof pathRecord.$ref === "string" &&
    Object.keys(pathRecord).length === 1
  )
    return true;
  if (
    Object.keys(pathRecord).some((key) => !httpVerbs.includes(key as HttpVerb))
  )
    return false;
  if (
    Object.values(pathRecord).some(
      (pathRef) =>
        typeof pathRef !== "object" ||
        !("$ref" in pathRef) ||
        typeof pathRef.$ref !== "string",
    )
  )
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
  if (
    !("paths" in loadedApiDoc) ||
    !loadedApiDoc.paths ||
    typeof loadedApiDoc.paths !== "object"
  )
    return false;
  if (
    Object.values(loadedApiDoc.paths).some((path) => !isValidPathRecord(path))
  )
    return false;
  return true;
}

function getOrCreatePathRecord(api: ApiShape, fullPath: string, verb: string) {
  if (api.paths[fullPath] && "$ref" in api.paths[fullPath])
    throw new Error(
      `Unable to add API route at '${verb}' ${fullPath}; this path has a $ref defined`,
    );
  const pathRecord: PathRecord = api.paths[fullPath] || {};
  if (verb in pathRecord) {
    throw new Error(
      `Unable to add API route at '${verb}' ${fullPath}; this route is already defined`,
    );
  }
  return pathRecord;
}

// Replace the expressjs :varName from the path with {varName} for docs
function formatPathVariables(pathFragment: string) {
  return pathFragment.replace(/:(\w+)/g, "{$1}");
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
  const endpointTags = api.tags.map((tag) => tag.name);
  api["x-tagGroups"].push({
    name: "Endpoints",
    tags: endpointTags,
  });

  // Before generating types, programmatically add all models to the spec
  const models = fs
    .readdirSync(path.join(__dirname, "../api/openapi/schemas"))
    .filter((fileName) => !fileName.includes("index"))
    .map((fileName) => fileName.replace(".yaml", ""));

  // Set up references for ApiModel classes
  API_MODELS.forEach((modelClass) => {
    const modelConfig = modelClass.getModelConfig();
    if (!modelConfig.apiConfig) return;
    const apiConfig = modelConfig.apiConfig;
    const singularCapitalized = capitalizeFirstCharacter(
      apiConfig.modelSingular,
    );
    const pluralCapitalized = capitalizeFirstCharacter(apiConfig.modelPlural);
    models.push(singularCapitalized);
    endpointTags.push(pluralCapitalized);
    const crudConfig = getCrudConfig(apiConfig);
    crudConfig.forEach(
      ({ action, verb, pathFragment, validator, returnKey, plural }) => {
        const fullPath = apiConfig.pathBase + formatPathVariables(pathFragment);
        const pathRecord = getOrCreatePathRecord(api, fullPath, verb);
        const returnSchema =
          action === "delete"
            ? {
                type: "object",
                required: ["deletedId"],
                properties: {
                  deletedId: { type: "string" },
                },
              }
            : {
                type: "object",
                required: [returnKey],
                properties: {
                  [returnKey]: z.toJSONSchema(
                    plural
                      ? z.array(apiConfig.apiInterface)
                      : apiConfig.apiInterface,
                  ),
                },
              };
        pathRecord[verb] = generateYamlForPath({
          path: fullPath,
          verb,
          validator,
          returnSchema,
          operationId: `${action}${plural ? pluralCapitalized : singularCapitalized}`,
          summary: getDefaultCrudActionSummary(
            action,
            apiConfig.modelSingular,
            apiConfig.modelPlural,
          ),
          tags: [pluralCapitalized],
        });
        api.paths[fullPath] = pathRecord;
      },
    );
    (apiConfig.customHandlers ?? []).forEach(
      ({
        pathFragment,
        verb,
        operationId,
        validator,
        summary,
        zodReturnObject,
      }) => {
        const fullPath = apiConfig.pathBase + formatPathVariables(pathFragment);
        const pathRecord = getOrCreatePathRecord(api, fullPath, verb);
        pathRecord[verb] = generateYamlForPath({
          path: fullPath,
          verb,
          validator,
          returnSchema: z.toJSONSchema(zodReturnObject),
          operationId,
          tags: [pluralCapitalized],
          summary,
        });
        api.paths[fullPath] = pathRecord;
      },
    );
    const schema = z.toJSONSchema(apiConfig.apiInterface);
    schema.$skipValidatorGeneration = true;
    api.components.schemas[singularCapitalized] = schema;
  });

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
