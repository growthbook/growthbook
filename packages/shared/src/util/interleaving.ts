import type {
  InterleavingInterface,
  InterleavingMetricConfig,
} from "../validators/interleaving";

export type InterleavingSnapshotRunSettingsFromParent = {
  interleavingId: string;
  trackingKey: string;
  interleavingQueryId: string;
  userIdType: string;
  variationNames: [string, string];
  metrics: InterleavingMetricConfig[];
  startDate: Date;
  endDate?: Date | null;
};

export function getInterleavingSnapshotRunSettings(
  interleaving: Pick<
    InterleavingInterface,
    | "id"
    | "trackingKey"
    | "interleavingQueryId"
    | "userIdType"
    | "variations"
    | "metrics"
    | "dateStarted"
    | "dateStopped"
  >,
): InterleavingSnapshotRunSettingsFromParent {
  if (!interleaving.dateStarted) {
    throw new Error(
      "Start this interleaving experiment before updating its results",
    );
  }
  const [a, b] = interleaving.variations;
  return {
    interleavingId: interleaving.id,
    trackingKey: interleaving.trackingKey,
    interleavingQueryId: interleaving.interleavingQueryId,
    userIdType: interleaving.userIdType,
    variationNames: [a.key, b.key],
    metrics: interleaving.metrics,
    startDate: interleaving.dateStarted,
    endDate: interleaving.dateStopped ?? null,
  };
}

/** Parses a ranker config, requiring a JSON object. */
export function parseInterleavingRankerConfig(
  config: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(config);
  } catch (e) {
    throw new Error(
      `Ranker config must be valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ranker config must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
