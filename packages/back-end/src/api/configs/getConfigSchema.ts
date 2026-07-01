import { getConfigSchemaValidator } from "shared/validators";
import { SchemaField } from "shared/types/feature";
import {
  resolveConfigChain,
  linearizeConfigDag,
  getConfigSpineRootKey,
  configIsExtensible,
  fieldsToJsonSchema,
  fieldsToTsType,
  fieldsToProto,
  fieldsToGolang,
  fieldsToRust,
  fieldsToPython,
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
    // Resolve the base DAG (parent + `extends` mixins) base → leaf, "base wins".
    // Uses the unfiltered set since lineage can span projects the caller can't
    // read (read access to the target itself was gated above).
    //
    // Intentional disclosure: the effective schema surfaces ancestor-declared
    // field shapes (not values) across project boundaries — it's incomplete
    // without them.
    const all = await req.context.models.configs.getAllForReconcile();
    const byKey = new Map(all.map((c) => [c.key, c]));
    byKey.set(config.key, config);
    const chain = linearizeConfigDag(config.key, byKey);
    fields = resolveConfigChain(chain).effectiveSchema;
    // Extensibility is governed by the `parent`-spine root's checkbox; mixin
    // bases' extensibility is ignored under composition.
    const spineRoot = byKey.get(getConfigSpineRootKey(config.key, byKey));
    additionalProperties = configIsExtensible(
      spineRoot,
      req.context.org.settings?.configsExtensibleByDefault,
    );
  } else {
    fields = config.schema?.fields ?? [];
    additionalProperties = config.schema?.additionalProperties ?? false;
  }

  const projection = req.query.source
    ? config.renderProjections?.[req.query.source]
    : undefined;

  // Typed-code formats share a `(fields, opts)` signature; JSON Schema is
  // separate (it returns a native object, not a source string).
  const codeRenderers = {
    typescript: fieldsToTsType,
    protobuf: fieldsToProto,
    python: fieldsToPython,
    go: fieldsToGolang,
    rust: fieldsToRust,
  } as const;

  const schema =
    format in codeRenderers
      ? {
          type: format as keyof typeof codeRenderers,
          value: codeRenderers[format as keyof typeof codeRenderers](fields, {
            name: toPascalCase(config.key),
            additionalProperties,
            projection,
          }),
        }
      : {
          type: "json-schema" as const,
          value: JSON.parse(
            fieldsToJsonSchema(fields, {
              type: "object",
              additionalProperties,
            }),
          ),
        };

  return {
    schema,
    effective,
    additionalProperties,
  };
});
