import { fetch } from "back-end/src/util/http.util";
import {
  SCHEMA_REGISTRY_API_KEY,
  SCHEMA_REGISTRY_API_SECRET,
  SCHEMA_REGISTRY_URL,
} from "back-end/src/util/secrets";

type LatestSchemaResponse = {
  id?: unknown;
  message?: unknown;
  error_message?: unknown;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getSchemaRegistryAuthHeader(): string {
  return `Basic ${Buffer.from(
    `${SCHEMA_REGISTRY_API_KEY}:${SCHEMA_REGISTRY_API_SECRET}`,
  ).toString("base64")}`;
}

export function getEventForwarderSchemaSubject(topic: string): string {
  return `${topic}-value`;
}

function safeParseJson(text: string): LatestSchemaResponse | null {
  try {
    return JSON.parse(text) as LatestSchemaResponse;
  } catch {
    return null;
  }
}

export async function getLatestEventForwarderSchemaId(
  topic: string,
): Promise<number> {
  if (
    !SCHEMA_REGISTRY_URL ||
    !SCHEMA_REGISTRY_API_KEY ||
    !SCHEMA_REGISTRY_API_SECRET
  ) {
    throw new Error(
      "Missing schema registry config: SCHEMA_REGISTRY_URL, SCHEMA_REGISTRY_API_KEY, SCHEMA_REGISTRY_API_SECRET",
    );
  }

  const subject = encodeURIComponent(getEventForwarderSchemaSubject(topic));
  const response = await fetch(
    `${trimTrailingSlash(SCHEMA_REGISTRY_URL)}/subjects/${subject}/versions/latest`,
    {
      headers: {
        Authorization: getSchemaRegistryAuthHeader(),
        "Content-Type": "application/json",
      },
    },
  );

  const text = await response.text();
  const parsed = text ? safeParseJson(text) : null;

  if (!response.ok) {
    const message =
      (typeof parsed?.message === "string" && parsed.message) ||
      (typeof parsed?.error_message === "string" && parsed.error_message) ||
      text ||
      `${response.status} ${response.statusText}`;
    throw new Error(
      `Failed to fetch latest schema for ${getEventForwarderSchemaSubject(topic)}: ${message}`,
    );
  }

  const schemaId = parsed?.id;
  if (typeof schemaId !== "number" || schemaId <= 0) {
    throw new Error(
      `Schema registry returned an invalid schema id for ${getEventForwarderSchemaSubject(topic)}`,
    );
  }

  return schemaId;
}
