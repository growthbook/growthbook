import path from "path";
import fs from "fs";
import { z } from "zod";
import yaml from "js-yaml";
import _apiRouter from "back-end/src/api/api.router";
import { getAllRegisteredOpenApiRouters } from "back-end/src/util/handler";

// This is just to force the import to happen
// We only care about the side effects of the import
// If you don't the import, typescript will strip it out
console.log(_apiRouter.name);

async function run() {
  const routers = getAllRegisteredOpenApiRouters();

  // TODO: add description, security, tags, etc.
  const openapiSpec: any = {
    openapi: "3.0.0",
    info: {
      title: "GrowthBook API",
      version: "1.0.0",
    },
    paths: {},
  };

  for (const { basePath, routes } of routers) {
    for (const [verb, path, handler] of routes) {
      const { operationId, summary, tags, schemas } = handler;

      const parameters: any = [];

      // URL params
      if (schemas?.params) {
        const jsonSchema = z.toJSONSchema(schemas.params);
        Object.entries(jsonSchema.properties ?? {}).forEach(
          ([name, schema]) => {
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
          },
        );
      }

      // Query params
      if (schemas?.query) {
        const jsonSchema = z.toJSONSchema(schemas.query);
        Object.entries(jsonSchema.properties ?? {}).forEach(
          ([name, schema]) => {
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
          },
        );
      }

      let requestBody: any = null;
      if (schemas?.body) {
        const jsonSchema = z.toJSONSchema(schemas.body);
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
              schema: z.toJSONSchema(schemas?.response || z.object({})),
            },
          },
        },
      };

      // Relace express style path parameters with OpenAPI style path parameters
      // and remove leading slash
      const fullPath =
        "/" +
        basePath.replace(/^\//, "").replace(/\/$/, "") +
        "/" +
        path.replace(/:(\w+)/g, "{$1}").replace(/^\//, "");

      openapiSpec.paths[fullPath] = openapiSpec.paths[fullPath] || {};
      openapiSpec.paths[fullPath][verb] = {
        operationId,
        summary,
        tags,
        parameters,
        requestBody,
        responses,
      };
    }
  }

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
