import { EventUser } from "shared/types/events/event-types";

export type ApiRateLimitSettings = {
  max: number;
  maxByKey: Map<string, number>;
  separateWrites: boolean;
  separateRequesters: boolean;
};

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function getApiRateLimitBucket(
  {
    apiKey,
    method,
    eventAudit,
  }: { apiKey: string; method: string; eventAudit: EventUser },
  settings: ApiRateLimitSettings,
): { key: string; max: number; writes: boolean } {
  const writes = settings.separateWrites && !READ_METHODS.has(method);
  // Self-asserted, but always a resolved org member: other values are a 400.
  const requesterId =
    settings.separateRequesters && eventAudit?.type === "api_key"
      ? (eventAudit.requestedBy?.id ?? null)
      : null;

  return {
    key: [apiKey, requesterId, writes ? "writes" : null]
      .filter(Boolean)
      .join(":"),
    max: settings.maxByKey.get(apiKey) ?? settings.max,
    writes,
  };
}
