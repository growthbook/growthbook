import path from "path";
import fs from "fs";
import * as url from "url";
import SwaggerParser from "@apidevtools/swagger-parser";
import openapiTS from "openapi-typescript";
import { parseSchema } from "json-schema-to-zod";
import { load } from "js-yaml";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

const generatedFileHeader = `/* eslint-disable */
/**
* This file was auto-generated. DO NOT MODIFY DIRECTLY
* Instead, modify the source OpenAPI schema in back-end/src/api/openapi
* and run \`yarn generate-api-types\` to re-generate this file.
*/
`;

async function run() {
  // Step 1: Turn yaml files into a single OpenAPI JSON file
  const spec = path.join(__dirname, "..", "..", "generated", "spec.yaml");
  const api = load(fs.readFileSync(spec));
  const dereferenced = await SwaggerParser.dereference(api);
  const validators = [];

  // Step 2: Convert to Typescript types
  let output = await openapiTS(api, {
    commentHeader: generatedFileHeader,
    postTransform: (type) => {
      // The `openapi-typescript` library outputs bad types for arbitrary objects
      // Replace them with `any` here
      return type.replace(/Record<string, never>/g, "any");
    },
  });

  // Step 3: Add additional named types for easier access
  // Export each schema as a named type
  output += `import { z } from "zod";\n`;
  output += `import * as openApiValidators from "shared/validators";\n`;
  output += "\n// Schemas\n";
  Object.entries(api.components.schemas).forEach(([k, schema]) => {
    if (schema.$skipValidatorGeneration) return;
    // Zod validator for response body
    validators.push(
      `export const api${k}Validator = ${generateZodSchema(schema)}`,
    );

    output += `export type Api${k} = z.infer<typeof openApiValidators.api${k}Validator>;\n`;
  });

  // Export each API operation's response value as a named type
  output += "\n// Operations\n";
  Object.values(dereferenced.paths).forEach((p) => {
    ["get", "post", "put", "delete", "patch"].forEach((method) => {
      if (p[method] && !p[method].$skipValidatorGeneration) {
        const id = p[method]["operationId"];
        const titleCase = id.substring(0, 1).toUpperCase() + id.substring(1);

        // Type for response body
        output += `export type ${titleCase}Response = operations["${id}"]["responses"]["200"]["content"]["application/json"];\n`;

        // Zod validators for request params, querystring, and body
        const requestSchema =
          p[method].requestBody?.["content"]?.["application/json"]?.["schema"];
        const { querySchema, pathSchema } = getParameterSchemas([
          ...(p.parameters || []),
          ...(p[method].parameters || []),
        ]);
        validators.push(
          `export const ${id}Validator = {
  bodySchema: ${generateZodSchema(requestSchema, false, false)},
  querySchema: ${generateZodSchema(querySchema, true, true)},
  paramsSchema: ${generateZodSchema(pathSchema)},
};`,
        );
      }
    });
  });

  // Step 4: Persist specs and generated files to file system
  fs.writeFileSync(
    path.join(__dirname, "..", "..", "..", "shared", "types", "openapi.d.ts"),
    output,
  );
  fs.writeFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "shared",
      "src",
      "validators",
      "openapi.ts",
    ),
    generatedFileHeader +
      `import { z } from "zod";\n\n` +
      validators.join("\n\n"),
  );

  // Step 5: Generate Redoc badge CSS for tags/operations marked x-beta: true
  const betaTags = (api.tags || [])
    .filter((t) => t["x-beta"])
    .map((t) => t.name);

  const betaOperationIds = [];
  Object.values(api.paths || {}).forEach((pathItem) => {
    ["get", "post", "put", "delete", "patch"].forEach((method) => {
      const op = pathItem[method];
      if (op?.["x-beta"] && op.operationId) {
        betaOperationIds.push(op.operationId);
      }
    });
  });

  const allBetaSelectors = [
    ...betaTags.flatMap((name) => [
      `li[data-item-id="tag/${name}"] > label span:first-of-type::after`,
      `[id="tag/${name}"] h2::after`,
    ]),
    ...betaOperationIds.flatMap((id) => [
      `li[data-item-id="operation/${id}"] > label span:first-of-type::after`,
      `[id="operation/${id}"] h2::after`,
    ]),
  ];

  if (allBetaSelectors.length > 0) {
    const betaCSS = `${allBetaSelectors.join(",\n")} {
  content: "BETA";
  background-color: #fbbf24;
  color: #78350f;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 0px 8px;
  margin-left: 8px;
  align-items: center;
  display: inline-flex;
  height: 18px;
  vertical-align: middle;
}
`;
    fs.writeFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "docs",
        "src",
        "styles",
        "components",
        "_redoc-beta.scss",
      ),
      betaCSS,
    );
  }
}

run()
  .then(() => console.log("Done!"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

// Query params are strings; accept "true"/"false"/"0"/"1" and coerce to boolean.
const QUERY_BOOLEAN_COERCION =
  'z.union([z.literal("true"), z.literal("false"), z.literal("0"), z.literal("1"), z.boolean()]).optional().default(false).transform((v) => v === true || v === "true" || v === "1")';
const QUERY_BOOLEAN_COERCION_TRUE =
  'z.union([z.literal("true"), z.literal("false"), z.literal("0"), z.literal("1"), z.boolean()]).optional().default(true).transform((v) => v === true || v === "true" || v === "1")';

function generateZodSchema(
  jsonSchema,
  coerceStringsToNumbers = true,
  coerceBooleansFromQuery = false,
) {
  if (!jsonSchema) {
    return `z.never()`;
  }

  let zod = parseSchema(jsonSchema);

  if (zod.startsWith("z.object")) {
    zod += ".strict()";
  }

  if (coerceStringsToNumbers) {
    zod = zod.replace(/z\.number\(\)/g, "z.coerce.number()");
  }

  if (coerceBooleansFromQuery) {
    // Single pass: one regex matches .default(true), .default(false), or bare z.boolean().
    // A second pass would match z.boolean() inside the replacement and create nested unions.
    zod = zod.replace(
      /z\.boolean\(\)(\.default\((true|false)\))?/g,
      (_, _suffix, defaultVal) =>
        defaultVal === "true" ? QUERY_BOOLEAN_COERCION_TRUE : QUERY_BOOLEAN_COERCION,
    );
  }

  // remove overly strick datetime zod validation
  // until we can write custom regex validator
  zod = zod.replace(/(?<=string\(\))\.datetime\(\{.*?\}\)/g, "");

  // Convert zod v3 style z.record(valueType) to zod v4 style z.record(z.string(), valueType)
  // This handles the breaking change in zod v4 where z.record() requires explicit key and value types
  zod = zod.replace(/z\.record\(([^)]+)\)/g, "z.record(z.string(), $1)");

  // Fix zod v3 -> v4 breaking changes in superRefine (generated by json-schema-to-zod for oneOf):
  // 1. ctx.path no longer exists in $RefinementCtx
  zod = zod.replace(/path:\s*ctx\.path,\s*/g, "");
  // 2. invalid_union now requires errors: $ZodIssue[][] instead of unionErrors: ZodError[]
  zod = zod.replace(/unionErrors:\s*errors/g, "errors: errors.map(e => e.issues)");

  return zod;
}

function getParameterSchemas(parameters) {
  // Get schemas for params, query, and request body
  const queryProperties = {};
  const pathProperties = {};
  const requiredQueryParams = [];
  const requiredPathParams = [];
  parameters.forEach((param) => {
    if (param.in === "query") {
      queryProperties[param.name] = param.schema;
      if (param.required) {
        requiredQueryParams.push(param.name);
      }
    } else if (param.in === "path") {
      pathProperties[param.name] = param.schema;
      if (param.required) {
        requiredPathParams.push(param.name);
      }
    }
  });
  const querySchema = Object.keys(queryProperties).length
    ? {
        type: "object",
        required: requiredQueryParams,
        properties: queryProperties,
      }
    : null;
  const pathSchema = Object.keys(pathProperties).length
    ? {
        type: "object",
        required: requiredPathParams,
        properties: pathProperties,
      }
    : null;

  return {
    querySchema,
    pathSchema,
  };
}
