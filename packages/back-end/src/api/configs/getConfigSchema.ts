import { getConfigSchemaValidator } from "shared/validators";
import { SchemaField, SimpleSchema } from "shared/types/feature";
import {
  ConfigChainNode,
  resolveConfigChain,
  getConfigParentKey,
  configIsExtensible,
  fieldsToJsonSchema,
  fieldsToTsType,
  stringToBoolean,
} from "shared/util";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

// `checkout-flow` → `CheckoutFlow` for the rendered TypeScript interface name.
function toPascalCase(key: string): string {
  return (
    key
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("") || "ConfigSchema"
  );
}

export const getConfigSchema = createApiRequestHandler(
  getConfigSchemaValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config with that key");
  }

  const format = req.query.format ?? "json-schema";
  const effective = stringToBoolean(req.query.effective?.toString());

  let fields: SchemaField[];
  let additionalProperties: boolean;

  if (effective) {
    // Walk ancestors (leaf → base), then resolve base → leaf to accumulate the
    // family's effective schema (first-seen key wins, "base wins").
    const chain: ConfigChainNode[] = [];
    const visited = new Set<string>();
    let cur: typeof config | null = config;
    let rootConfig: typeof config = config;
    while (cur && !visited.has(cur.key)) {
      visited.add(cur.key);
      rootConfig = cur;
      chain.unshift({
        key: cur.key,
        name: cur.name,
        value: cur.value,
        schema: cur.schema,
      });
      const parentKey = getConfigParentKey(cur);
      cur = parentKey
        ? await req.context.models.configs.getByKey(parentKey)
        : null;
    }
    fields = resolveConfigChain(chain).effectiveSchema;
    additionalProperties = configIsExtensible(
      rootConfig,
      req.context.org.settings?.configsExtensibleByDefault,
    );
  } else {
    fields = config.schema?.fields ?? [];
    additionalProperties = config.schema?.additionalProperties ?? false;
  }

  const simpleSchema: SimpleSchema = {
    type: "object",
    fields,
    additionalProperties,
  };

  let rendered: string | null = null;
  if (format === "json-schema") {
    rendered = fieldsToJsonSchema(fields, {
      type: "object",
      additionalProperties,
    });
  } else if (format === "typescript") {
    rendered = fieldsToTsType(fields, {
      name: toPascalCase(config.key),
      additionalProperties,
    });
  }

  return {
    format,
    effective,
    additionalProperties,
    simpleSchema,
    rendered,
  };
});
