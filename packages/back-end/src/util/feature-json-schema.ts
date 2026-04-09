import { FeatureInterface, JSONSchemaDef } from "shared/types/feature";

/**
 * Creates the JSON schema payload for a newly-created feature.
 * If source schema settings are provided (e.g. duplicate flow), preserve them.
 * Always refresh the `date` field at creation time.
 */
export function getInitialFeatureJsonSchema(
  jsonSchema?: FeatureInterface["jsonSchema"],
): JSONSchemaDef {
  const schemaType =
    jsonSchema?.schemaType === "schema" || jsonSchema?.schemaType === "simple"
      ? jsonSchema.schemaType
      : "schema";

  return {
    schemaType,
    simple: jsonSchema?.simple ?? {
      type: "object",
      fields: [],
    },
    schema: jsonSchema?.schema ?? "",
    date: new Date(),
    enabled: jsonSchema?.enabled ?? false,
  };
}
