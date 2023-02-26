import path from "path";
import fs from "fs";
import * as url from "url";
import SwaggerParser from "@apidevtools/swagger-parser";
import openapiTS from "openapi-typescript";
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

async function run() {
  // Step 1: Turn yml files into a single OpenAPI JSON file
  const api = await SwaggerParser.bundle(
    path.join(__dirname, "..", "api", "openapi", "openapi.yml")
  );

  // Step 2: Convert to Typescript types
  let output = await openapiTS(api, {
    commentHeader: `/* eslint-disable */
/**
 * This file was auto-generated. DO NOT MODIFY DIRECTLY
 * Instead, modify the source OpenAPI schema in back-end/src/api/openapi
 * and run \`yarn generate-api-types\` to re-generate this file.
 */`,
    postTransform: (type) => {
      // The `openapi-typescript` library outputs bad types for arbitrary objects
      // Replace them with `any` here
      return type.replace(/Record<string, never>/g, "any");
    },
  });

  // Step 3: Add additional named types for easier access
  // Export each schema as a named type
  output += "\n// Schemas\n";
  Object.keys(api.components.schemas).forEach((k) => {
    output += `export type Api${k} = components["schemas"]["${k}"];\n`;
  });

  // Export each API operation's response value as a named type
  output += "\n// Operations\n";
  Object.values(api.paths).forEach((p) => {
    // TODO: generate types for request params, query strings, and request bodies
    ["get", "post", "put", "delete", "patch"].forEach((method) => {
      if (p[method]) {
        const id = p[method]["operationId"];
        const titleCase = id.substring(0, 1).toUpperCase() + id.substring(1);
        output += `export type ${titleCase}Response = operations["${id}"]["responses"]["200"]["content"]["application/json"];\n`;
      }
    });
  });

  // Step 4: Write to a JSON and .d.ts file
  fs.writeFileSync(
    path.join(__dirname, "..", "api", "openapi", "openapi.json"),
    JSON.stringify(api, null, 2)
  );
  fs.writeFileSync(
    path.join(__dirname, "..", "..", "types", "openapi.d.ts"),
    output
  );
}

run()
  .then(() => console.log("Done!"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
