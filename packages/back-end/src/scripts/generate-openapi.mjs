import path from "path";
import fs from "fs";
import * as url from "url";
import SwaggerParser from "@apidevtools/swagger-parser";
import openapiTS from "openapi-typescript";
import { parseSchema } from "json-schema-to-zod";
import { load } from "js-yaml";
import { parse as dirtyJsonParse } from "dirty-json";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

const generatedFileHeader = `/* eslint-disable */
/**
* This file was auto-generated. DO NOT MODIFY DIRECTLY
* Instead, modify the source OpenAPI schema in back-end/src/api/openapi
* and run \`yarn generate-api-types\` to re-generate this file.
*/
`;

function generateExampleRequest(operation) {
  const codeSample = operation["x-codeSamples"]?.[0]?.source;
  if (!codeSample) return null;

  // Extract path params, set each one to just "abc123"
  const pathParams = operation.parameters
    ?.filter((param) => param.in === "path")
    .map((param) => [param.name, "abc123"]);

  const exampleRequest = {};

  if (pathParams?.length > 0) {
    exampleRequest.params = Object.fromEntries(pathParams);
  }

  // Extract body from the `-d` line in the code sample
  // Might be split across multiple lines, have escape sequences
  // Might also be invalid JSON, if so, skip the code sample entirely
  const body = codeSample.split("-d '")[1]?.split("'")[0];
  if (body) {
    try {
      exampleRequest.body = dirtyJsonParse(body);
    } catch (e) {
      return null;
    }
  }

  // If empty object, return null
  if (Object.keys(exampleRequest).length === 0) {
    return null;
  }

  return JSON.stringify(exampleRequest);
}

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
  Object.entries(dereferenced.paths).forEach(([path, p]) => {
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

        const exampleRequest = generateExampleRequest(p[method]);

        const responseSchema =
          p[method].responses["200"]["content"]["application/json"]["schema"];
        validators.push(
          `export const ${id}Validator = {
  bodySchema: ${generateZodSchema(requestSchema, false, false)},
  querySchema: ${generateZodSchema(querySchema, true, true)},
  paramsSchema: ${generateZodSchema(pathSchema)},
  responseSchema: ${generateZodSchema(responseSchema)},
  summary: "${p[method].summary}",
  operationId: "${id}",
  tags: [${p[method].tags?.map((tag) => `"${tag}"`).join(", ")}],
  method: "${method}" as const,
  path: "${path}"${
    exampleRequest ? `,\n  exampleRequest: ${exampleRequest}` : ""
  },
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

const DEPRECATED_META = ".meta({ deprecated: true })";

/**
 * json-schema-to-zod ignores `deprecated`. Walk the JSON Schema tree and inject
 * `.meta({ deprecated: true })` on matching Zod fields so z.toJSONSchema (OpenAPI 2) preserves it.
 * Returns { pathKeys, leafSchema }[] where leafSchema is the JSON Schema of the deprecated field.
 */
function collectDeprecatedLeaves(node, pathKeys = []) {
  const out = [];
  if (!node || typeof node !== "object") return out;

  if (node.properties && typeof node.properties === "object") {
    for (const [key, prop] of Object.entries(node.properties)) {
      const next = [...pathKeys, key];
      if (prop.deprecated === true) {
        out.push({ pathKeys: next, leafSchema: prop });
      }
      out.push(...collectDeprecatedLeaves(prop, next));
    }
  }

  if (
    node.additionalProperties &&
    typeof node.additionalProperties === "object"
  ) {
    const ap = node.additionalProperties;
    if (ap.properties && typeof ap.properties === "object") {
      for (const [key, prop] of Object.entries(ap.properties)) {
        const next = [...pathKeys, key];
        if (prop.deprecated === true) {
          out.push({ pathKeys: next, leafSchema: prop });
        }
        out.push(...collectDeprecatedLeaves(prop, next));
      }
    } else {
      out.push(...collectDeprecatedLeaves(ap, pathKeys));
    }
  }

  if (node.items && typeof node.items === "object") {
    out.push(...collectDeprecatedLeaves(node.items, pathKeys));
  }

  for (const comb of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(node[comb])) {
      for (const branch of node[comb]) {
        out.push(...collectDeprecatedLeaves(branch, pathKeys));
      }
    }
  }

  if (Array.isArray(node.prefixItems)) {
    for (const item of node.prefixItems) {
      out.push(...collectDeprecatedLeaves(item, pathKeys));
    }
  }

  return out;
}

function walkStringState(str, i, state) {
  const c = str[i];
  if (state.esc) {
    state.esc = false;
    return true;
  }
  if (state.inStr) {
    if (c === "\\") state.esc = true;
    else if (c === state.quote) state.inStr = false;
    return true;
  }
  if (c === '"' || c === "'" || c === "`") {
    state.inStr = true;
    state.quote = c;
    return true;
  }
  return false;
}

function findMatchingBrace(str, openIdx) {
  let depth = 0;
  const state = { inStr: false, esc: false, quote: null };
  for (let i = openIdx; i < str.length; i++) {
    if (walkStringState(str, i, state)) continue;
    const c = str[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findMatchingSquareBracket(str, openIdx) {
  let depth = 0;
  const state = { inStr: false, esc: false, quote: null };
  for (let i = openIdx; i < str.length; i++) {
    if (walkStringState(str, i, state)) continue;
    const c = str[i];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * End index (exclusive) of a Zod schema expression starting at zIndex (the `z` in `z.string()`, etc.).
 * Tracks () and [] only so `z.object({ ... })` braces do not confuse the parser.
 */
function findZExpressionEnd(zodStr, zIndex) {
  let p = 0;
  let b = 0;
  let inStr = false;
  let esc = false;
  let quote = null;
  for (let i = zIndex; i < zodStr.length; i++) {
    const c = zodStr[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (c === "\\") esc = true;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = true;
      quote = c;
      continue;
    }
    if (c === "(") p++;
    else if (c === ")") p--;
    else if (c === "[") b++;
    else if (c === "]") b--;

    if (p === 0 && b === 0) {
      if (c === "," && zodStr.slice(i, i + 3) === ', "') return i;
      if (c === "}") return i;
    }
  }
  return zodStr.length;
}

function zPropertyNeedle(key) {
  return `${JSON.stringify(key)}: z.`;
}

/**
 * Narrow from current window `w` into the inner body of a child property `key`
 * (e.g. z.object body, z.array(z.union([...])) union list, z.record value object).
 * Returns { inner, startInW } where inner is the substring to keep searching, and
 * startInW is the index in `w` where `inner` begins.
 */
function narrowIntoChildWindow(w, key) {
  const k = zPropertyNeedle(key);
  const tries = [
    { pat: `${k}object({`, closer: findMatchingBrace, openOffset: -1 },
    { pat: `${k}array(z.object({`, closer: findMatchingBrace, openOffset: -1 },
    {
      pat: `${k}record(z.string(), z.object({`,
      closer: findMatchingBrace,
      openOffset: -1,
    },
    {
      pat: `${k}array(z.union([`,
      closer: findMatchingSquareBracket,
      openOffset: -1,
    },
  ];
  for (const { pat, closer, openOffset } of tries) {
    const pos = w.indexOf(pat);
    if (pos === -1) continue;
    const openIdx = pos + pat.length + openOffset;
    const closeIdx = closer(w, openIdx);
    if (closeIdx < 0) continue;
    return { inner: w.slice(openIdx + 1, closeIdx), startInW: openIdx + 1 };
  }
  return null;
}

function leafNeedleCandidates(key, leafSchema) {
  const k = JSON.stringify(key);
  const t = leafSchema?.type;
  if (t === "array") return [`${k}: z.array`];
  if (t === "object") return [`${k}: z.object`];
  if (t === "number" || t === "integer") {
    return [`${k}: z.coerce.number`, `${k}: z.number`];
  }
  return [zPropertyNeedle(key)];
}

function injectDeprecatedMetaForLeaf(zodStr, pathKeys, leafSchema) {
  if (!pathKeys.length) return zodStr;

  let w = zodStr;
  let base = 0;

  for (let d = 0; d < pathKeys.length - 1; d++) {
    const narrowed = narrowIntoChildWindow(w, pathKeys[d]);
    if (!narrowed) return zodStr;
    base += narrowed.startInW;
    w = narrowed.inner;
  }

  const leafKey = pathKeys[pathKeys.length - 1];
  let leafPos = -1;
  let needle = "";
  for (const cand of leafNeedleCandidates(leafKey, leafSchema)) {
    leafPos = w.indexOf(cand);
    if (leafPos !== -1) {
      needle = cand;
      break;
    }
  }
  if (leafPos === -1) return zodStr;

  const zStart = leafPos + needle.indexOf("z");
  const zEnd = findZExpressionEnd(w, zStart);
  const insertAt = base + zEnd;
  if (
    zodStr.slice(insertAt, insertAt + DEPRECATED_META.length) ===
    DEPRECATED_META
  )
    return zodStr;

  return zodStr.slice(0, insertAt) + DEPRECATED_META + zodStr.slice(insertAt);
}

function injectDeprecatedMeta(jsonSchema, zodStr) {
  if (!jsonSchema || typeof jsonSchema !== "object") return zodStr;
  const raw = collectDeprecatedLeaves(jsonSchema);
  const seen = new Set();
  const leaves = [];
  for (const entry of raw) {
    const k = JSON.stringify(entry.pathKeys);
    if (!seen.has(k)) {
      seen.add(k);
      leaves.push(entry);
    }
  }
  leaves.sort((a, b) => b.pathKeys.length - a.pathKeys.length);
  let out = zodStr;
  for (const { pathKeys, leafSchema } of leaves) {
    out = injectDeprecatedMetaForLeaf(out, pathKeys, leafSchema);
  }
  return out;
}

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
        defaultVal === "true"
          ? QUERY_BOOLEAN_COERCION_TRUE
          : QUERY_BOOLEAN_COERCION,
    );
  }

  // json-schema-to-zod emits z.string().datetime({ offset: true }) for format: date-time.
  // Keep ISO-8601 documentation in OpenAPI (Zod-first spec uses z.toJSONSchema) without
  // enforcing Zod's strict datetime pattern at runtime.
  zod = zod.replace(
    /z\.string\(\)\.datetime\(\{[^}]*\}\)/g,
    'z.string().meta({ format: "date-time" })',
  );
  zod = zod.replace(
    /z\.string\(\)\.datetime\(\)/g,
    'z.string().meta({ format: "date-time" })',
  );

  // Fix Zod 3 → Zod 4 superRefine compatibility for oneOf schemas.
  // json-schema-to-zod emits ctx.addIssue with code:"invalid_union" and ctx.path,
  // neither of which exist in Zod 4's $RefinementCtx.
  zod = zod
    .replace(/path: ctx\.path,\s*/g, "")
    .replace(/code: "invalid_union",\s*/g, 'code: "custom",\n')
    .replace(/unionErrors: errors,\s*/g, "");

  // Convert zod v3 style z.record(valueType) to zod v4 style z.record(z.string(), valueType)
  // This handles the breaking change in zod v4 where z.record() requires explicit key and value types
  zod = zod.replace(/z\.record\(([^)]+)\)/g, "z.record(z.string(), $1)");

  zod = injectDeprecatedMeta(jsonSchema, zod);

  // If the zod schema has a `description` field, add it as metadata to the zod schema
  if (jsonSchema.description && !zod.includes(".describe(")) {
    zod = zod + `.describe("${jsonSchema.description}")`;
  }

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
      if (param.description && !param.schema.description) {
        queryProperties[param.name].description = param.description;
      }
      if (param.required) {
        requiredQueryParams.push(param.name);
      }
    } else if (param.in === "path") {
      pathProperties[param.name] = param.schema;
      if (param.description && !param.schema.description) {
        pathProperties[param.name].description = param.description;
      }
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
