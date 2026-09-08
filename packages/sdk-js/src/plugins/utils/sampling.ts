import { readSessionJSON, writeSessionJSON } from "./storage";

type StoredDecision = {
  scopeId: string;
  sampled: boolean;
};

// True-random sampling with a decision that sticks for the given scope
// (e.g. one replay session), so reloads don't re-roll mid-scope. A new
// scopeId rolls fresh.
export function shouldSampleScope({
  rate,
  storageKey,
  scopeId,
  random = Math.random,
}: {
  rate: number;
  storageKey: string;
  scopeId: string;
  random?: () => number;
}): boolean {
  const stored = readSessionJSON(storageKey) as StoredDecision | null;
  if (
    stored &&
    stored.scopeId === scopeId &&
    typeof stored.sampled === "boolean"
  ) {
    return stored.sampled;
  }

  const sampled = rate >= 1 || (rate > 0 && random() < rate);
  writeSessionJSON(storageKey, { scopeId, sampled });
  return sampled;
}

// Record an explicit decision for a scope (e.g. a programmatically forced
// recording), so reloads within the scope honor it over the sample rate.
export function persistSampleDecision(
  storageKey: string,
  scopeId: string,
  sampled: boolean,
): void {
  writeSessionJSON(storageKey, { scopeId, sampled });
}
