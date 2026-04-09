import path from "path";
import fs from "fs";
import { z, ZodNever } from "zod";
import yaml from "js-yaml";
import { allRoutes } from "back-end/src/api/api.router";

function isNonEmtySchema(schema: z.ZodType | undefined): schema is z.ZodType {
  return schema !== undefined && !(schema instanceof ZodNever);
}

// Accumulated component schemas — populated as we call toOpenApiSchema.
const componentSchemas: Record<string, unknown> = {};

/**
 * Recursively replace `{ $ref: "#/$defs/X" }` with `{ $ref: "#/components/schemas/X" }`.
 */
function rewriteRefs(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(rewriteRefs);
  if (obj && typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    if ("$ref" in record && typeof record.$ref === "string") {
      return { $ref: record.$ref.replace("#/$defs/", "#/components/schemas/") };
    }
    return Object.fromEntries(
      Object.entries(record).map(([k, v]) => [k, rewriteRefs(v)]),
    );
  }
  return obj;
}

/**
 * Convert a ZodType to an OpenAPI-compatible JSON Schema object.
 * - Strips the top-level `$schema` meta-field emitted by `z.toJSONSchema`.
 * - Hoists any `$defs` (produced by `namedSchema`) into `componentSchemas`.
 * - Rewrites `$ref` pointers from `#/$defs/X` to `#/components/schemas/X`.
 */
function toOpenApiSchema(schema: z.ZodType): z.core.JSONSchema.BaseSchema {
  const {
    $schema: _$schema,
    $defs,
    ...rest
  } = z.toJSONSchema(schema, {
    unrepresentable: "any",
  }) as Record<string, unknown>;
  if ($defs && typeof $defs === "object") {
    for (const [name, def] of Object.entries(
      $defs as Record<string, unknown>,
    )) {
      if (!componentSchemas[name]) {
        // Strip the `id` field that .meta({ id }) injects into the def itself
        const { id: _id, ...defRest } = def as Record<string, unknown>;
        componentSchemas[name] = rewriteRefs(defRest);
      }
    }
  }
  return rewriteRefs(rest) as z.core.JSONSchema.BaseSchema;
}

/**
 * Build a cURL code sample from the example request data and route metadata.
 */
function buildCurlSample(
  verb: string,
  fullPath: string,
  example: { params?: unknown; body?: unknown; query?: unknown },
): string {
  // Substitute path params into the URL
  let url = `https://api.growthbook.io/api/v1${fullPath}`;
  if (example.params && typeof example.params === "object") {
    for (const [key, value] of Object.entries(
      example.params as Record<string, unknown>,
    )) {
      url = url.replace(`{${key}}`, String(value));
    }
  }

  // Append query params
  if (example.query && typeof example.query === "object") {
    const entries = Object.entries(example.query as Record<string, unknown>);
    if (entries.length > 0) {
      const qs = entries
        .map(
          ([k, v]) =>
            `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
        )
        .join("&");
      url += `?${qs}`;
    }
  }

  const parts: string[] = [`curl -X ${verb.toUpperCase()} '${url}'`];
  parts.push(`  -H 'Authorization: Bearer YOUR_API_KEY'`);

  if (example.body) {
    parts.push(`  -H 'Content-Type: application/json'`);
    parts.push(`  -d '${JSON.stringify(example.body)}'`);
  }

  return parts.join(" \\\n");
}

type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema: z.core.JSONSchema.BaseSchema;
};

type RequestBody = {
  required: boolean;
  content: {
    "application/json": {
      schema: z.core.JSONSchema.BaseSchema;
    };
  };
};

type Response = {
  content: {
    "application/json": {
      schema: z.core.JSONSchema.BaseSchema;
    };
  };
};

type Path = {
  operationId: string;
  summary?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses: Record<string, Response>;
};

type CodeSample = { lang: string; source: string };

async function run() {
  // TODO: add description, security, tags, etc.
  const openapiSpec: {
    openapi: string;
    info: {
      version: string;
      title: string;
      description: string;
    };
    servers: {
      url: string;
      description: string;
    }[];
    paths: Record<string, Record<string, Path>>;
  } = {
    openapi: "3.1.0",
    info: {
      version: "1.0.0",
      title: "GrowthBook REST API",
      description: `GrowthBook offers a full REST API for interacting with the application.

Request data can use either JSON or Form data encoding (with proper \`Content-Type\` headers). All response bodies are JSON-encoded.

The API base URL for GrowthBook Cloud is \`https://api.growthbook.io\`. For self-hosted deployments, it is the same as your API_HOST environment variable (defaults to \`http://localhost:3100\`). The rest of these docs will assume you are using GrowthBook Cloud.

## Authentication

We support both the HTTP Basic and Bearer authentication schemes for convenience.

You first need to generate a new API Key in GrowthBook. Different keys have different permissions:

- **Personal Access Tokens**: These are sensitive and provide the same level of access as the user has to an organization. These can be created by going to \`Personal Access Tokens\` under the your user menu.
- **Secret Keys**: These are sensitive and provide the level of access for the role, which currently is either \`admin\` or \`readonly\`. Only Admins with the \`manageApiKeys\` permission can manage Secret Keys on behalf of an organization. These can be created by going to \`Settings -> API Keys\`

If using HTTP Basic auth, pass the Secret Key as the username and leave the password blank:

\`\`\`bash
curl https://api.growthbook.io/api/v1 \\
  -u secret_abc123DEF456:
# The ":" at the end stops curl from asking for a password
\`\`\`

If using Bearer auth, pass the Secret Key as the token:

\`\`\`bash
curl https://api.growthbook.io/api/v1 \\
-H "Authorization: Bearer secret_abc123DEF456"
\`\`\`

## Errors

The API may return the following error status codes:

- **400** - Bad Request - Often due to a missing required parameter
- **401** - Unauthorized - No valid API key provided
- **402** - Request Failed - The parameters are valid, but the request failed
- **403** - Forbidden - Provided API key does not have the required access
- **404** - Not Found - Unknown API route or requested resource
- **429** - Too Many Requests - You exceeded the rate limit of 60 requests per minute. Try again later.
- **5XX** - Server Error - Something went wrong on GrowthBook's end (these are rare)

The response body will be a JSON object with the following properties:

- **message** - Information about the error
`,
    },
    servers: [
      {
        url: "https://api.growthbook.io/api/v1",
        description: "GrowthBook Cloud",
      },
      {
        url: "https://{domain}/api/v1",
        description: "Self-hosted GrowthBook",
      },
    ],
    paths: {},
  };

  for (const route of allRoutes) {
    const {
      operationId,
      summary,
      tags,
      schemas,
      method,
      path,
      exampleRequest,
    } = route;

    if (!path || !method || !operationId) {
      //console.log(route);
      continue;
    }

    const parameters: Parameter[] = [];

    // URL params
    if (isNonEmtySchema(schemas?.params)) {
      const jsonSchema = toOpenApiSchema(schemas.params);
      Object.entries(jsonSchema.properties ?? {}).forEach(([name, schema]) => {
        parameters.push({
          name,
          in: "path",
          required: (jsonSchema.required ?? []).includes(name),
          description:
            (schema as z.core.JSONSchema.BaseSchema).description || "",
          schema: schema as z.core.JSONSchema.BaseSchema,
        });
      });
    }

    // Query params
    if (isNonEmtySchema(schemas?.query)) {
      const jsonSchema = toOpenApiSchema(schemas.query);
      Object.entries(jsonSchema.properties ?? {}).forEach(([name, schema]) => {
        parameters.push({
          name,
          in: "query",
          required: (jsonSchema.required ?? []).includes(name),
          description:
            (schema as z.core.JSONSchema.BaseSchema).description || "",
          schema: schema as z.core.JSONSchema.BaseSchema,
        });
      });
    }

    let requestBody: RequestBody | undefined = undefined;
    if (isNonEmtySchema(schemas?.body)) {
      const jsonSchema = toOpenApiSchema(schemas.body);
      requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: jsonSchema,
          },
        },
      };
    }

    const responses: Record<string, Response> = {
      "200": {
        content: {
          "application/json": {
            schema: toOpenApiSchema(schemas?.response || z.object({})),
          },
        },
      },
    };

    // Relace express style path parameters with OpenAPI style path parameters
    const fullPath = path.replace(/:(\w+)/g, "{$1}");

    // Build code samples from example data
    const codeSamples: CodeSample[] = [];
    if (exampleRequest) {
      codeSamples.push({
        lang: "curl",
        source: buildCurlSample(method, fullPath, exampleRequest),
      });
    }

    openapiSpec.paths[fullPath] = openapiSpec.paths[fullPath] || {};
    openapiSpec.paths[fullPath][method] = {
      operationId,
      summary,
      tags,
      parameters,
      ...(requestBody !== undefined && { requestBody }),
      responses,
      ...(codeSamples.length > 0 && { "x-codeSamples": codeSamples }),
    };
  }

  console.log(openapiSpec);

  fs.writeFileSync(
    path.join(__dirname, "..", "..", "generated", "spec2.yaml"),
    yaml.dump(openapiSpec),
  );
}

run()
  .then(() => console.log("Done!"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
