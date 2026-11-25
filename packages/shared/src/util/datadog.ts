export const DATADOG_API_KEY_HEADER = "DD-API-KEY";

export const datadogSites = [
  {
    id: "datadoghq.com",
    label: "US1 (datadoghq.com)",
    app: "app.datadoghq.com",
  },
  {
    id: "us3.datadoghq.com",
    label: "US3 (us3.datadoghq.com)",
    app: "us3.datadoghq.com",
  },
  {
    id: "us5.datadoghq.com",
    label: "US5 (us5.datadoghq.com)",
    app: "us5.datadoghq.com",
  },
  { id: "datadoghq.eu", label: "EU1 (datadoghq.eu)", app: "app.datadoghq.eu" },
  {
    id: "ap1.datadoghq.com",
    label: "AP1 (ap1.datadoghq.com)",
    app: "ap1.datadoghq.com",
  },
  {
    id: "ap2.datadoghq.com",
    label: "AP2 (ap2.datadoghq.com)",
    app: "ap2.datadoghq.com",
  },
  {
    id: "ddog-gov.com",
    label: "US1-FED (ddog-gov.com)",
    app: "app.ddog-gov.com",
  },
] as const;

export type DatadogSite = (typeof datadogSites)[number];

export function datadogEventsUrl(site: string): string {
  return `https://event-management-intake.${site}/api/v2/events`;
}

export function datadogSiteForUrl(url: string): DatadogSite | null {
  return datadogSites.find((site) => datadogEventsUrl(site.id) === url) ?? null;
}

// Header names are case-insensitive.
export function findHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  return Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
}

// Why a Datadog webhook can't be saved as is, or null when it can. The
// intake only takes POST and authenticates with the API key header.
export function datadogWebhookProblem({
  method,
  headers,
}: {
  method?: string;
  headers?: Record<string, string>;
}): string | null {
  if (method && method !== "POST") {
    return "Datadog webhooks must use the POST method.";
  }
  const apiKey = headers?.[findHeader(headers, DATADOG_API_KEY_HEADER) ?? ""];
  if (!apiKey?.trim()) {
    return `Datadog webhooks need a ${DATADOG_API_KEY_HEADER} header, for example {"${DATADOG_API_KEY_HEADER}": "{{ DATADOG_API_KEY }}"} referencing a webhook secret.`;
  }
  return null;
}
