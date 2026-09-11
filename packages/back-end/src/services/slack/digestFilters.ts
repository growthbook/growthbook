type DigestFilterConfig = {
  projects: string[];
  tags: string[];
  environments: string[];
  ids: string[];
};

export type DigestEvent = {
  event?: string;
  objectId?: string;
  data?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];

export const digestEventMatchesSubscription = (
  event: Pick<DigestEvent, "event">,
  subscriptions: string[],
) =>
  subscriptions.some(
    (subscription) =>
      subscription === event.event ||
      (subscription.endsWith(".*") &&
        !!event.event &&
        event.event.startsWith(subscription.slice(0, -1))),
  );

const overlaps = (wanted: string[], actual: string[]) =>
  wanted.length === 0 || wanted.some((value) => actual.includes(value));

export const digestEventPassesFilters = (
  event: DigestEvent,
  filters: DigestFilterConfig,
): boolean => {
  const data = isRecord(event.data) ? event.data : {};
  const nested = isRecord(data.data) ? data.data : {};
  const projects = stringArray(data.projects).length
    ? stringArray(data.projects)
    : stringArray(nested.projects);
  const tags = stringArray(data.tags).length
    ? stringArray(data.tags)
    : stringArray(nested.tags);
  const environment =
    typeof data.environment === "string"
      ? data.environment
      : typeof nested.environment === "string"
        ? nested.environment
        : null;
  const environments = stringArray(data.environments).length
    ? stringArray(data.environments)
    : stringArray(nested.environments).length
      ? stringArray(nested.environments)
      : environment
        ? [environment]
        : [];
  return (
    (filters.ids.length === 0 ||
      (!!event.objectId && filters.ids.includes(event.objectId))) &&
    overlaps(filters.projects, projects) &&
    overlaps(filters.tags, tags) &&
    overlaps(filters.environments, environments)
  );
};

export const digestEventLine = (event: DigestEvent): string => {
  const payload = isRecord(event.data) ? event.data : {};
  const data = isRecord(payload.data) ? payload.data : payload;
  const object = isRecord(data.object) ? data.object : {};
  const name = [
    object.experimentName,
    object.name,
    object.experimentId,
    object.id,
    event.objectId,
  ].find((value) => typeof value === "string" && value.length);
  return `• ${event.event || "Update"} — ${name || "Unnamed"}`
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 130);
};

export const summarizeDigestEvents = async (
  events: AsyncIterable<DigestEvent>,
  subscriptions: string[],
  filters: DigestFilterConfig,
  deadline: Date,
): Promise<{ count: number; lines: string[] }> => {
  const summary = { count: 0, lines: [] as string[] };
  for await (const event of events) {
    if (Date.now() >= deadline.getTime())
      throw new Error("Digest scan exceeded its delivery lease");
    if (
      !digestEventMatchesSubscription(event, subscriptions) ||
      !digestEventPassesFilters(event, filters)
    )
      continue;
    summary.count++;
    if (summary.lines.length < 20) summary.lines.push(digestEventLine(event));
  }
  return summary;
};
