import path from "path";
import fs from "fs";
import { z, ZodNever } from "zod";
import yaml from "js-yaml";
import { allRoutes } from "back-end/src/api/api.router";

function isNonEmtySchema(schema: z.ZodType | undefined): schema is z.ZodType {
  return schema !== undefined && !(schema instanceof ZodNever);
}

async function run() {
  // TODO: add description, security, tags, etc.
  const openapiSpec: any = {
    openapi: "3.0.0",
    info: {
      title: "GrowthBook API",
      version: "1.0.0",
    },
    paths: {},
  };

  for (const route of allRoutes) {
    const { operationId, summary, tags, schemas, method, path } = route;

    if (!path || !method || !operationId) {
      //console.log(route);
      continue;
    }

    const parameters: any = [];

    // URL params
    if (isNonEmtySchema(schemas?.params)) {
      const jsonSchema = z.toJSONSchema(schemas.params, {
        unrepresentable: "any",
      });
      Object.entries(jsonSchema.properties ?? {}).forEach(([name, schema]) => {
        parameters.push({
          name,
          in: "path",
          required: (jsonSchema.required ?? []).includes(name),
          description:
            schema && typeof schema === "object" && "description" in schema
              ? schema.description
              : "",
          schema: schema,
        });
      });
    }

    // Query params
    if (isNonEmtySchema(schemas?.query)) {
      const jsonSchema = z.toJSONSchema(schemas.query, {
        unrepresentable: "any",
      });
      Object.entries(jsonSchema.properties ?? {}).forEach(([name, schema]) => {
        parameters.push({
          name,
          in: "query",
          required: (jsonSchema.required ?? []).includes(name),
          description:
            schema && typeof schema === "object" && "description" in schema
              ? schema.description
              : "",
          schema: schema,
        });
      });
    }

    let requestBody: any = null;
    if (isNonEmtySchema(schemas?.body)) {
      const jsonSchema = z.toJSONSchema(schemas.body, {
        unrepresentable: "any",
      });
      requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: jsonSchema,
          },
        },
      };
    }

    const responses: any = {
      "200": {
        content: {
          "application/json": {
            schema: z.toJSONSchema(schemas?.response || z.object({}), {
              unrepresentable: "any",
            }),
          },
        },
      },
    };

    // Relace express style path parameters with OpenAPI style path parameters
    const fullPath = path.replace(/:(\w+)/g, "{$1}");

    openapiSpec.paths[fullPath] = openapiSpec.paths[fullPath] || {};
    openapiSpec.paths[fullPath][method] = {
      operationId,
      summary,
      tags,
      parameters,
      requestBody,
      responses,
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
