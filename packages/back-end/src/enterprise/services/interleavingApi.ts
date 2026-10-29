import type {
  ApiInterleavingInterface,
  ApiInterleavingSnapshotInterface,
  ApiInterleavingSnapshotStatus,
  InterleavingInterface,
  InterleavingSnapshotInterface,
} from "shared/validators";

export function toApiInterleavingSnapshot(
  doc: InterleavingSnapshotInterface,
): ApiInterleavingSnapshotInterface {
  const { settings: s } = doc;
  return {
    id: doc.id,
    interleavingId: doc.interleavingId,
    status: doc.status,
    error: doc.error,
    dateCreated: doc.dateCreated.toISOString(),
    runStarted: doc.runStarted?.toISOString() ?? null,
    settings: {
      trackingKey: s.trackingKey,
      datasourceId: s.datasourceId,
      interleavingExposureQueryId: s.interleavingExposureQueryId,
      userIdType: s.userIdType,
      variations: s.variations,
      metrics: s.metrics,
      pValueThreshold: s.pValueThreshold,
      runs: s.runs.map((r) => ({
        dateStarted: r.dateStarted.toISOString(),
        dateEnded: r.dateEnded.toISOString(),
      })),
      startDate: s.startDate.toISOString(),
      endDate: s.endDate.toISOString(),
    },
    results: doc.results,
  };
}

export function toApiInterleavingSnapshotStatus(
  doc: InterleavingSnapshotInterface,
): ApiInterleavingSnapshotStatus {
  return {
    id: doc.id,
    status: doc.status,
    error: doc.error,
    dateCreated: doc.dateCreated.toISOString(),
    runStarted: doc.runStarted?.toISOString() ?? null,
    queries: doc.queries,
  };
}

type ApiVariation = ApiInterleavingInterface["variations"][number];

const apiVariation = (
  v: InterleavingInterface["variations"][number],
): ApiVariation => ({
  id: v.id,
  key: v.key,
  name: v.name,
  description: v.description,
  config: v.config,
});

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
    variations: [
      apiVariation(doc.variations[0]),
      apiVariation(doc.variations[1]),
    ],
    jsonSchema: doc.jsonSchema
      ? { ...doc.jsonSchema, date: doc.jsonSchema.date.toISOString() }
      : null,
    datasource: doc.datasource,
    interleavingExposureQueryId: doc.interleavingExposureQueryId,
    userIdType: doc.userIdType,
    metrics: doc.metrics,
    coverage: doc.coverage,
    condition: doc.condition,
    savedGroups: doc.savedGroups,
    prerequisites: doc.prerequisites,
    environmentSettings: doc.environmentSettings,
  };
}
