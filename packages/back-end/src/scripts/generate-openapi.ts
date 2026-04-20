import path from "path";
import fs from "fs";
import { z, ZodNever } from "zod";
import yaml from "js-yaml";
import { namedSchemaRegistry } from "shared/validators";
import { allRoutes, apiModelTagMeta } from "back-end/src/api/api.router";

const openApiTags = [
  "projects",
  "environments",
  "features",
  "feature-revisions",
  "ramp-schedules",
  "data-sources",
  "fact-tables",
  "fact-metrics",
  "metrics",
  "experiments",
  "snapshots",
  "dimensions",
  "segments",
  "sdk-connections",
  "visual-changesets",
  "saved-groups",
  "organizations",
  "members",
  "code-references",
  "archetypes",
  "queries",
  "settings",
  "attributes",
  "usage",
] as const;

export type OpenApiTag = (typeof openApiTags)[number];

const tags: Record<OpenApiTag, { display: string; description: string }> = {
  projects: {
    display: "Projects",
    description:
      "Projects are used to organize your feature flags and experiments",
  },
  environments: {
    display: "Environments",
    description:
      "GrowthBook comes with one environment by default (production), but you can add as many as you need. When used with feature flags, you can enable/disable feature flags on a per-environment basis.",
  },
  features: {
    display: "Feature Flags",
    description: "Control your feature flags programatically",
  },
  "feature-revisions": {
    display: "Feature Revisions",
    description:
      "Draft revisions for feature flags, including rules, scheduling, and approval workflows.\n\nThese endpoints are in beta and are subject to change.",
  },
  "ramp-schedules": {
    display: "Ramp Schedules",
    description:
      "Multi-step rollout schedules that gradually ramp feature rule changes over time, with support for interval, approval, and scheduled triggers.",
  },
  "data-sources": {
    display: "Data Sources",
    description:
      "How GrowthBook connects and queries your data, including cached database schema metadata (information schemas) for tables and columns.",
  },
  "fact-tables": {
    display: "Fact Tables",
    description: "Fact Tables describe the shape of your data warehouse tables",
  },
  "fact-metrics": {
    display: "Fact Metrics",
    description:
      "Fact Metrics are metrics built on top of Fact Table definitions",
  },
  metrics: {
    display: "Metrics (legacy)",
    description: "Metrics used as goals and guardrails for experiments",
  },
  experiments: {
    display: "Experiments",
    description: "Experiments (A/B Tests)",
  },
  snapshots: {
    display: "Experiment Snapshots",
    description:
      "Experiment Snapshots (the individual updates of an experiment)",
  },
  dimensions: {
    display: "Dimensions",
    description: "Dimensions used during experiment analysis",
  },
  segments: {
    display: "Segments",
    description: "Segments used during experiment analysis",
  },
  "sdk-connections": {
    display: "SDK Connections",
    description:
      "Client keys and settings for connecting SDKs to a GrowthBook instance",
  },
  "visual-changesets": {
    display: "Visual Changesets",
    description:
      "Groups of visual changes made by the visual editor to a single page",
  },
  "saved-groups": {
    display: "Saved Groups",
    description:
      "Defined sets of attribute values which can be used with feature rules for targeting features at particular users.",
  },
  members: {
    display: "Members",
    description: "Members are users who have been invited to an organization.",
  },
  organizations: {
    display: "Organizations",
    description:
      "Organizations are used for multi-org deployments where different teams can run their own isolated feature flags and experiments. These endpoints are only via a super-admin's Personal Access Token.",
  },
  "code-references": {
    display: "Code References",
    description:
      "Intended for use with our code reference CI utility, [`gb-find-code-refs`](https://github.com/growthbook/gb-find-code-refs).",
  },
  archetypes: {
    display: "Archetypes",
    description:
      "Archetypes allow you to simulate the result of targeting rules on pre-set user attributes",
  },
  queries: {
    display: "Queries",
    description: "Retrieve queries used in experiments to calculate results.",
  },
  settings: {
    display: "Settings",
    description: "Get the organization settings.",
  },
  attributes: {
    display: "Attributes",
    description: "Used when targeting feature flags and experiments.",
  },
  usage: {
    display: "Usage",
    description: "Usage information for metrics in experiments.",
  },
};

function isNonEmptySchema(schema: z.ZodType | undefined): schema is z.ZodType {
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
    override: (ctx) => {
      // TODO: remove
      // minimum: -9007199254740991
      // maximum: 9007199254740991
      if (ctx.zodSchema === undefined) return;
      const jsonSchema = ctx.jsonSchema as z.core.JSONSchema.BaseSchema;
      if (jsonSchema.minimum === -9007199254740991) {
        delete jsonSchema.minimum;
      }
      if (jsonSchema.maximum === 9007199254740991) {
        delete jsonSchema.maximum;
      }
    },
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

type Ref = {
  $ref: string;
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
  description?: string;
  content: {
    "application/json": {
      schema: z.core.JSONSchema.BaseSchema;
    };
  };
};

type Path = {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: (Parameter | Ref)[];
  requestBody?: RequestBody;
  responses: Record<string, Response>;
  "x-codeSamples"?: CodeSample[];
};

type CodeSample = { lang: string; source: string };

async function run() {
  // TODO: add security, etc.
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
    tags: {
      name: string;
      description: string;
      "x-displayName": string;
    }[];
    security: Record<string, unknown[]>[];
    paths: Record<string, Record<string, Path>>;
    components: {
      parameters: Record<string, Parameter>;
      schemas: Record<string, z.core.JSONSchema.BaseSchema>;
      securitySchemes: Record<
        string,
        {
          type: string;
          scheme: string;
          description: string;
        }
      >;
    };
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

If using HTTP Basic auth, pass the Secret Key as the username and leave the password blank (when using curl, add \`:\` at the end of the secret to indicate an empty password)

\`\`\`bash
curl https://api.growthbook.io/api/v1 \\
  -u secret_abc123DEF456:
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
    tags: openApiTags.map((id) => ({
      name: id,
      "x-displayName": tags[id].display,
      description: tags[id].description,
    })),
    security: [{ bearerAuth: [] }, { basicAuth: [] }],
    paths: {},
    components: {
      parameters: {},
      schemas: {},
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: `If using Bearer auth, pass the Secret Key as the token:
\`\`\`bash
curl https://api.growthbook.io/api/v1 \
  -H "Authorization: Bearer secret_abc123DEF456"
\`\`\`
`,
        },
        basicAuth: {
          type: "http",
          scheme: "basic",
          description: `If using HTTP Basic auth, pass the Secret Key as the username and leave the password blank:
\`\`\`bash
curl https://api.growthbook.io/api/v1 \
  -u secret_abc123DEF456:
# The ":" at the end stops curl from asking for a password
\`\`\`
`,
        },
      },
    },
  };

  const parameterRefs: Record<string, Parameter> = {};
  const schemaRefs: Record<string, z.core.JSONSchema.BaseSchema> = {};

  // Be able to look up a schema by its JSON stringified schema
  const schemaHashMap: Record<string, string> = {};

  for (const route of allRoutes) {
    if (route.excludeFromSpec) {
      continue;
    }

    const {
      operationId,
      summary,
      description,
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

    const parameters: (Parameter | Ref)[] = [];

    // URL params
    if (isNonEmptySchema(schemas?.params)) {
      const jsonSchema = toOpenApiSchema(schemas.params);
      Object.entries(jsonSchema.properties ?? {}).forEach(([name, schema]) => {
        const isRequired = (jsonSchema.required ?? []).includes(name);
        const parameter: Parameter = {
          name,
          in: "path",
          ...(isRequired && { required: true }),
          description:
            (schema as z.core.JSONSchema.BaseSchema).description || "",
          schema: schema as z.core.JSONSchema.BaseSchema,
        };

        let useRef = false;
        if (!parameterRefs[name]) {
          parameterRefs[name] = parameter;
          useRef = true;
        } else if (
          JSON.stringify(parameterRefs[name].schema) ===
            JSON.stringify(schema) &&
          parameterRefs[name].in === "path"
        ) {
          useRef = true;
        }

        if (useRef) {
          parameters.push({ $ref: `#/components/parameters/${name}` });
        } else {
          parameters.push(parameter);
        }
      });
    }

    // Query params
    if (isNonEmptySchema(schemas?.query)) {
      const jsonSchema = toOpenApiSchema(schemas.query);
      Object.entries(jsonSchema.properties ?? {}).forEach(([name, schema]) => {
        const isRequired = (jsonSchema.required ?? []).includes(name);
        // Hoist x- extension fields from schema to parameter level
        const schemaObj = schema as Record<string, unknown>;
        const extensions: Record<string, unknown> = {};
        for (const key of Object.keys(schemaObj)) {
          if (key.startsWith("x-")) {
            extensions[key] = schemaObj[key];
            delete schemaObj[key];
          }
        }

        const parameter: Parameter = {
          name,
          in: "query",
          ...(isRequired && { required: true }),
          description:
            (schema as z.core.JSONSchema.BaseSchema).description || "",
          schema: schema as z.core.JSONSchema.BaseSchema,
          ...extensions,
        };

        let useRef = false;
        if (!parameterRefs[name]) {
          parameterRefs[name] = parameter;
          useRef = true;
        } else if (
          JSON.stringify(parameterRefs[name].schema) ===
            JSON.stringify(schema) &&
          parameterRefs[name].in === "query"
        ) {
          useRef = true;
        }

        if (useRef) {
          parameters.push({ $ref: `#/components/parameters/${name}` });
        } else {
          parameters.push(parameter);
        }
      });
    }

    let requestBody: RequestBody | undefined = undefined;
    if (isNonEmptySchema(schemas?.body)) {
      const jsonSchema = toOpenApiSchema(schemas.body);
      requestBody = {
        required: !(schemas.body instanceof z.ZodOptional),
        content: {
          "application/json": {
            schema: jsonSchema,
          },
        },
      };
    }

    function rewriteResponseSchema(objSchema: z.core.JSONSchema.ObjectSchema) {
      if (!objSchema.properties) return;
      Object.entries(objSchema.properties).forEach(([name, schema]) => {
        if (!schema || typeof schema !== "object" || !("type" in schema)) {
          return;
        }

        if (schema.type === "object") {
          const key = JSON.stringify(schema);
          // Brand new schema and name, store for later and rewrite the schema to use a ref
          if (!schemaHashMap[key] && !schemaRefs[name]) {
            schemaHashMap[key] = name;
            schemaRefs[name] = schema;
            (objSchema.properties ?? {})[name] = {
              $ref: `#/components/schemas/${name}`,
            };
          }
          // Matching schema, rewrite the schema to use a ref
          else if (schemaHashMap[key]) {
            (objSchema.properties ?? {})[name] = {
              $ref: `#/components/schemas/${schemaHashMap[key]}`,
            };
          }
          // Otherwise, leave alone (don't rewrite)
        } else if (
          schema.type === "array" &&
          schema.items &&
          (schema.items as z.core.JSONSchema.ObjectSchema)?.type === "object"
        ) {
          const key = JSON.stringify(schema.items);
          // Brand new schema and name, store for later and rewrite the schema to use a ref
          if (!schemaHashMap[key] && !schemaRefs[name]) {
            schemaHashMap[key] = name;
            schemaRefs[name] = schema.items as z.core.JSONSchema.ObjectSchema;
            (
              (objSchema.properties ?? {})[
                name
              ] as z.core.JSONSchema.ArraySchema
            ).items = {
              $ref: `#/components/schemas/${name}`,
            };
          }
          // Matching schema, rewrite the schema to use a ref
          else if (schemaHashMap[key]) {
            (
              (objSchema.properties ?? {})[
                name
              ] as z.core.JSONSchema.ArraySchema
            ).items = {
              $ref: `#/components/schemas/${schemaHashMap[key]}`,
            };
          }
          // Otherwise, leave alone (don't rewrite)
        }
      });
    }

    // For each property in the response schema, if it's a nested object or array of objects,
    // store it in the schemaHashMap and re-use the definition if it already exists
    const responseSchema = toOpenApiSchema(schemas?.response || z.object({}));
    if ("properties" in responseSchema) {
      rewriteResponseSchema(responseSchema as z.core.JSONSchema.ObjectSchema);
    }
    // If response is using `allOf`, rewrite each branch
    if ("allOf" in responseSchema && Array.isArray(responseSchema.allOf)) {
      responseSchema.allOf.forEach((branch) => {
        if ("properties" in branch) {
          rewriteResponseSchema(branch as z.core.JSONSchema.ObjectSchema);
        }
      });
    }

    const responseDescription = responseSchema.description;
    if (responseDescription) {
      delete responseSchema.description;
    }

    const responses: Record<string, Response> = {
      "200": {
        ...(responseDescription && { description: responseDescription }),
        content: {
          "application/json": {
            schema: responseSchema,
          },
        },
      },
    };

    // Relace express style path parameters with OpenAPI style path parameters
    const fullPath = path.replace(/:(\w+)/g, "{$1}");

    // Build code samples from example data
    const codeSamples: CodeSample[] = [
      {
        lang: "cURL",
        source: buildCurlSample(method, fullPath, exampleRequest || {}),
      },
    ];

    openapiSpec.paths[fullPath] = openapiSpec.paths[fullPath] || {};
    openapiSpec.paths[fullPath][method] = {
      operationId,
      summary,
      ...(description !== undefined && { description }),
      tags,
      ...(parameters.length > 0 && { parameters }),
      ...(requestBody !== undefined && { requestBody }),
      responses,
      "x-codeSamples": codeSamples,
    };
  }

  // Auto-discover tags from routes that aren't in the hardcoded openApiTags list
  const knownTags = new Set<string>(openApiTags);
  const discoveredTags = new Set<string>();
  for (const route of allRoutes) {
    if (route.excludeFromSpec || !route.tags) continue;
    for (const tag of route.tags) {
      if (!knownTags.has(tag)) {
        discoveredTags.add(tag);
      }
    }
  }
  for (const tag of discoveredTags) {
    const meta = apiModelTagMeta[tag];
    // Split PascalCase into words for display name (e.g. "CustomFields" → "Custom Fields")
    const displayName =
      meta?.displayName || tag.replace(/([a-z])([A-Z])/g, "$1 $2");
    openapiSpec.tags.push({
      name: tag,
      "x-displayName": displayName,
      description: meta?.description ?? "",
    });
  }

  Object.entries(parameterRefs).forEach(([name, parameter]) => {
    openapiSpec.components.parameters[name] = parameter;
  });
  // Ensure every namedSchema()-registered validator appears in componentSchemas,
  // even if it was never referenced as a sub-schema of a response body.
  for (const [name, zodSchema] of namedSchemaRegistry) {
    if (!componentSchemas[name]) {
      const {
        $schema: _,
        id: _id,
        ...rest
      } = z.toJSONSchema(zodSchema, {
        unrepresentable: "any",
      }) as Record<string, unknown>;
      componentSchemas[name] = rewriteRefs(rest);
    }
  }

  // Named schemas (from namedSchema() calls) take precedence over deduped schemas
  Object.entries(componentSchemas).forEach(([name, schema]) => {
    openapiSpec.components.schemas[name] =
      schema as z.core.JSONSchema.BaseSchema;
  });
  Object.entries(schemaRefs).forEach(([name, schema]) => {
    openapiSpec.components.schemas[name] = schema;
  });

  // Generate _model tags for each named component schema (powers the "Models" section in docs)
  const modelTags: string[] = [];
  for (const name of Object.keys(componentSchemas).sort()) {
    const tagName = `${name}_model`;
    modelTags.push(tagName);
    openapiSpec.tags.push({
      name: tagName,
      "x-displayName": name,
      description: `<SchemaDefinition schemaRef="#/components/schemas/${name}" />`,
    });
  }

  // Build x-tagGroups for docs navigation
  const endpointTags: string[] = [
    ...openApiTags,
    ...Array.from(discoveredTags),
  ];
  (openapiSpec as Record<string, unknown>)["x-tagGroups"] = [
    { name: "Endpoints", tags: endpointTags },
    { name: "Models", tags: modelTags },
  ];

  fs.writeFileSync(
    path.join(__dirname, "..", "..", "generated", "spec.yaml"),
    yaml.dump(openapiSpec),
  );
}

run()
  .then(() => console.log("Done!"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
