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
    // Linearize the full base DAG (parent + every `extends` mixin) base → leaf,
    // then resolve to accumulate the family's effective schema (first-seen key
    // wins, "base wins"). Lineage can span projects the caller can't read, so use
    // the unfiltered set (read access to the target itself was gated above).
    //
    // NOTE (intentional disclosure): the effective schema can include field
    // definitions inherited from ancestor configs in projects the caller can't
    // independently read. This is by design — the effective schema is incomplete
    // without ancestors — but it does surface ancestor-declared field shapes
    // (not values) across project boundaries.
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

  // A captured per-source projection reproduces that consumer's named types.
  const projection = req.query.source
    ? config.renderProjections?.[req.query.source]
    : undefined;

  const schema =
    format === "typescript"
      ? {
          type: "typescript" as const,
          value: fieldsToTsType(fields, {
            name: toPascalCase(config.key),
            additionalProperties,
            projection,
          }),
        }
      : format === "protobuf"
        ? {
            type: "protobuf" as const,
            value: fieldsToProto(fields, {
              name: toPascalCase(config.key),
              additionalProperties,
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
