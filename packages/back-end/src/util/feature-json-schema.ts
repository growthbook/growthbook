import { FeatureInterface, JSONSchemaDef } from "shared/types/feature";
import { OrganizationInterface } from "shared/types/organization";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { logger } from "back-end/src/util/logger";

function getDefaultJsonSchema(date: Date): JSONSchemaDef {
  return {
    schemaType: "schema",
    schema: "",
    simple: { type: "object", fields: [] },
    date,
    enabled: false,
  };
}

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

  const defaultSchema = getDefaultJsonSchema(new Date());
  return {
    schemaType,
    simple: jsonSchema?.simple ?? defaultSchema.simple,
    schema: jsonSchema?.schema ?? defaultSchema.schema,
    date: defaultSchema.date,
    enabled: jsonSchema?.enabled ?? defaultSchema.enabled,
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
  const jsonSchemaWrapper = getDefaultJsonSchema(new Date());
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
