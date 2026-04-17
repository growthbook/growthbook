import { z } from "zod";
import {
  avroFieldMappingValidator,
  AvroFieldMappingInterface,
  AvroSchemaConfigInterface,
} from "shared/validators";
import mongoose from "mongoose";
import {
  createApiRequestHandler,
  OpenApiRoute,
  validateIsSuperUserRequest,
} from "back-end/src/util/handler";
import { _dangerousGetAvroSchemaConfigsForAllOrgs } from "back-end/src/models/AvroSchemaConfigDangerousModel";

// ── GET /ingestion/avro-schemas ──────────────────────────────────────
// Returns all org Avro schema configs (consumed by the ingestor alongside
// the data-enrichment endpoint). Super-user only.

interface AvroSchemasResponse {
  schemas: Record<
    string,
    { version: number; fields: AvroFieldMappingInterface[] }
  >;
}

export const getAvroSchemas = createApiRequestHandler({
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "get" as const,
  path: "/ingestion/avro-schemas",
  operationId: "getAvroSchemas",
  excludeFromSpec: true,
})(async (req): Promise<AvroSchemasResponse> => {
  await validateIsSuperUserRequest(req);

  const configs = await _dangerousGetAvroSchemaConfigsForAllOrgs();

  const schemas: AvroSchemasResponse["schemas"] = {};
  for (const config of configs) {
    schemas[config.organization] = {
      version: config.version,
      fields: config.fields,
    };
  }

  return { schemas };
});

// ── PUT /ingestion/avro-schemas/:orgId ───────────────────────────────
// Upsert dynamic Avro field mappings for an org. Used when a new
// attribute/property field is discovered and should be materialized.

const upsertBodySchema = z.object({
  fields: z.array(avroFieldMappingValidator),
});

interface UpsertAvroSchemaResponse {
  version: number;
  fields: AvroFieldMappingInterface[];
  diff: {
    added: string[];
    removed: string[];
    unchanged: number;
  };
}

export const upsertAvroSchema = createApiRequestHandler({
  bodySchema: upsertBodySchema,
  querySchema: z.never(),
  paramsSchema: z.object({ orgId: z.string() }),
  responseSchema: z.any(),
  method: "put" as const,
  path: "/ingestion/avro-schemas/:orgId",
  operationId: "upsertAvroSchema",
  excludeFromSpec: true,
})(async (req): Promise<UpsertAvroSchemaResponse> => {
  await validateIsSuperUserRequest(req);

  const { orgId } = req.params;
  const { fields: incomingFields } = req.body;

  const existing = await _dangerousGetAvroSchemaConfigForOrg(orgId);

  const existingFieldNames = new Set(
    (existing?.fields ?? []).map((f) => f.name),
  );
  const incomingFieldNames = new Set(incomingFields.map((f) => f.name));

  const added = incomingFields
    .filter((f) => !existingFieldNames.has(f.name))
    .map((f) => f.name);
  const removed = (existing?.fields ?? [])
    .filter((f) => !incomingFieldNames.has(f.name))
    .map((f) => f.name);
  const unchanged = incomingFields.length - added.length;

  const newVersion = (existing?.version ?? 0) + 1;

  await _dangerousUpsertAvroSchemaConfig(orgId, {
    version: newVersion,
    fields: incomingFields,
  });

  return {
    version: newVersion,
    fields: incomingFields,
    diff: { added, removed, unchanged },
  };
});

// ── GET /ingestion/avro-schemas/:orgId/diff ──────────────────────────
// Compare the stored schema with a proposed set of fields. Useful for
// previewing what would change before committing.

const diffQuerySchema = z.object({
  fields: z.string(),
});

interface DiffAvroSchemaResponse {
  currentVersion: number;
  added: AvroFieldMappingInterface[];
  removed: AvroFieldMappingInterface[];
  unchanged: AvroFieldMappingInterface[];
}

export const diffAvroSchema = createApiRequestHandler({
  bodySchema: z.never(),
  querySchema: diffQuerySchema,
  paramsSchema: z.object({ orgId: z.string() }),
  responseSchema: z.any(),
  method: "get" as const,
  path: "/ingestion/avro-schemas/:orgId/diff",
  operationId: "diffAvroSchema",
  excludeFromSpec: true,
})(async (req): Promise<DiffAvroSchemaResponse> => {
  await validateIsSuperUserRequest(req);

  const { orgId } = req.params;

  let proposedFields: AvroFieldMappingInterface[];
  try {
    proposedFields = z
      .array(avroFieldMappingValidator)
      .parse(JSON.parse(req.query.fields));
  } catch {
    throw new Error(
      "Invalid 'fields' query param — must be JSON array of AvroFieldMapping",
    );
  }

  const existing = await _dangerousGetAvroSchemaConfigForOrg(orgId);
  const existingFields = existing?.fields ?? [];

  const existingByName = new Map(existingFields.map((f) => [f.name, f]));
  const proposedByName = new Map(proposedFields.map((f) => [f.name, f]));

  const added = proposedFields.filter((f) => !existingByName.has(f.name));
  const removed = existingFields.filter((f) => !proposedByName.has(f.name));
  const unchanged = existingFields.filter((f) => proposedByName.has(f.name));

  return {
    currentVersion: existing?.version ?? 0,
    added,
    removed,
    unchanged,
  };
});

export const avroSchemaRoutes: OpenApiRoute[] = [
  getAvroSchemas,
  upsertAvroSchema,
  diffAvroSchema,
];

// ── Dangerous helpers (cross-org, no permission checks) ──────────────
// These mirror the pattern used in the data-enrichment endpoint.

const avroSchemaConfigCollection =
  mongoose.connection.collection("avroschemaconfigs");

async function _dangerousGetAvroSchemaConfigForOrg(
  orgId: string,
): Promise<AvroSchemaConfigInterface | null> {
  const doc = await avroSchemaConfigCollection.findOne({
    organization: orgId,
  });
  if (!doc) return null;
  return doc as unknown as AvroSchemaConfigInterface;
}

async function _dangerousUpsertAvroSchemaConfig(
  orgId: string,
  data: { version: number; fields: AvroFieldMappingInterface[] },
): Promise<void> {
  await avroSchemaConfigCollection.updateOne(
    { organization: orgId },
    {
      $set: {
        version: data.version,
        fields: data.fields,
        dateUpdated: new Date(),
      },
      $setOnInsert: {
        id: `avsc_${orgId}`,
        organization: orgId,
        dateCreated: new Date(),
      },
    },
    { upsert: true },
  );
}
