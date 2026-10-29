import type {
  ApiInterleavingInterface,
  InterleavingInterface,
} from "shared/validators";

export function toApiInterleaving(
  doc: InterleavingInterface,
): ApiInterleavingInterface {
  return {
    id: doc.id,
    dateCreated: doc.dateCreated.toISOString(),
    dateUpdated: doc.dateUpdated.toISOString(),
    name: doc.name,
    description: doc.description,
    project: doc.project,
    owner: doc.owner,
    tags: doc.tags,
    archived: doc.archived,
    status: doc.status,
    dateStarted: doc.dateStarted?.toISOString(),
    dateStopped: doc.dateStopped?.toISOString(),
    key: doc.key,
    trackingKey: doc.trackingKey,
    hashAttribute: doc.hashAttribute,
    seed: doc.seed,
    variations: doc.variations.map((v) => ({
      id: v.id,
      key: v.key,
      name: v.name,
      description: v.description,
      config: v.config,
    })),
    jsonSchema: doc.jsonSchema
      ? { ...doc.jsonSchema, date: doc.jsonSchema.date.toISOString() }
      : null,
    datasource: doc.datasource,
    interleavingQueryId: doc.interleavingQueryId,
    userIdType: doc.userIdType,
    metrics: doc.metrics,
    coverage: doc.coverage,
    condition: doc.condition,
    savedGroups: doc.savedGroups,
    prerequisites: doc.prerequisites,
    environmentSettings: doc.environmentSettings,
  };
}
