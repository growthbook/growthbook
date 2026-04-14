import { FeatureInterface, JSONSchemaDef } from "shared/types/feature";
import { OrganizationInterface } from "shared/types/organization";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { logger } from "back-end/src/util/logger";

const DEFAULT_JSON_SCHEMA: JSONSchemaDef = {
  schemaType: "schema",
  schema: "",
  simple: { type: "object", fields: [] },
  date: new Date(),
  enabled: false,
};

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
    simple: jsonSchema?.simple ?? DEFAULT_JSON_SCHEMA.simple,
    schema: jsonSchema?.schema ?? DEFAULT_JSON_SCHEMA.schema,
    date: new Date(),
    enabled: jsonSchema?.enabled ?? DEFAULT_JSON_SCHEMA.enabled,
  };
}

/**
 * Builds a JSONSchemaDef for the external REST API.
 * Gates on the `json-validation` premium feature and validates the raw JSON string.
 */
export function parseApiJsonSchema(
  org: OrganizationInterface,
  jsonSchema: string | undefined,
): JSONSchemaDef {
  const jsonSchemaWrapper: JSONSchemaDef = {
    ...DEFAULT_JSON_SCHEMA,
    date: new Date(),
  };
  if (!jsonSchema) return jsonSchemaWrapper;
  if (!orgHasPremiumFeature(org, "json-validation")) return jsonSchemaWrapper;
  try {
    jsonSchemaWrapper.schema = JSON.stringify(JSON.parse(jsonSchema));
    jsonSchemaWrapper.enabled = true;
    return jsonSchemaWrapper;
  } catch (e) {
    logger.error(e, "Failed to parse feature json schema");
    return jsonSchemaWrapper;
  }
}
