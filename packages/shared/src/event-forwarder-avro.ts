import type {
  SDKAttribute,
  SDKAttributeSchema,
  SDKAttributeType,
} from "shared/types/organization";

/** Stable record metadata for Schema Registry Avro payloads. */
export const EVENT_FORWARDER_AVRO_RECORD_NAME =
  "GrowthBookForwardedEvent" as const;
export const EVENT_FORWARDER_AVRO_NAMESPACE = "io.growthbook.events" as const;

/** Avro field definitions matching the ingestor payload in kafka.ts (minus dynamic org columns). */
export const EVENT_FORWARDER_AVRO_DEFAULT_FIELDS = [
  {
    name: "event_name",
    type: "string",
    source: "top-level",
  },
  {
    name: "event_uuid",
    type: ["null", "string"],
    default: null,
    source: "top-level",
  },
  {
    name: "timestamp",
    type: ["null", { type: "long", logicalType: "timestamp-millis" }],
    default: null,
    source: "top-level",
  },
  {
    name: "received_at",
    type: ["null", { type: "long", logicalType: "timestamp-millis" }],
    default: null,
    source: "top-level",
  },
  {
    name: "client_key",
    type: ["null", "string"],
    default: null,
    source: "top-level",
  },
  {
    name: "environment",
    type: ["null", "string"],
    default: null,
    source: "top-level",
  },
  {
    name: "sdk_language",
    type: ["null", "string"],
    default: null,
    source: "top-level",
  },
  {
    name: "sdk_version",
    type: ["null", "string"],
    default: null,
    source: "top-level",
  },
  {
    name: "ip",
    type: ["null", "string"],
    default: null,
    source: "top-level",
  },
  {
    name: "geo_country",
    type: ["null", "string"],
    default: null,
    source: "top-level",
  },
  {
    name: "geo_city",
    type: ["null", "string"],
    default: null,
    source: "top-level",
  },
  {
    name: "geo_lat",
    type: ["null", "double"],
    default: null,
    source: "top-level",
  },
  {
    name: "geo_lon",
    type: ["null", "double"],
    default: null,
    source: "top-level",
  },
  {
    name: "experiment_id",
    type: ["null", "string"],
    default: null,
    doc: "From SDK properties when present",
    source: "top-level",
  },
  {
    name: "variation_id",
    type: ["null", "string"],
    default: null,
    doc: "From SDK properties when present",
    source: "top-level",
  },
  {
    name: "properties",
    type: ["null", "string"],
    default: null,
    doc: "JSON-encoded event properties — dynamic per event type",
    source: "top-level",
  },
  {
    name: "additional_attributes",
    type: ["null", "string"],
    default: null,
    doc: "JSON-encoded attributes passed by the client that do not have a dedicated schema column",
    source: "top-level",
  },
] as const satisfies readonly DefaultFieldDescriptor[];

type DefaultFieldDescriptor = {
  readonly name: string;
  readonly type: unknown;
  readonly default?: unknown;
  readonly doc?: string;
  readonly source?: string;
};

export type EventForwarderAvroRecordSchema = {
  type: "record";
  name: typeof EVENT_FORWARDER_AVRO_RECORD_NAME;
  namespace: typeof EVENT_FORWARDER_AVRO_NAMESPACE;
  fields: unknown[];
};

const DEFAULT_FIELD_NAMES: Set<string> = new Set(
  EVENT_FORWARDER_AVRO_DEFAULT_FIELDS.map((f) => f.name),
);

/**
 * Sanitizes a string for use as an Avro/BigQuery/Snowflake field name.
 * Replaces any character that is not alphanumeric or underscore with "_",
 * prepends "_" if the result starts with a digit, and truncates to 255 chars.
 *
 * IMPORTANT: This logic is intentionally duplicated in
 * growthbook-ingestor/packages/ingestor/src/data.ts (`sanitizeAvroFieldName`).
 * These two repos cannot share code directly. If you change this function,
 * you MUST apply the same change there, and vice versa.
 */
export function sanitizeAvroFieldName(property: string): string {
  const sanitized = property.replace(/[^A-Za-z0-9_]+/g, "_");
  const withPrefix = /^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
  return withPrefix.slice(0, 255);
}

export function parseEnumSymbols(raw: string | undefined): string[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((s) => String(s));
    }
  } catch {
    // fall through
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function sdkDatatypeToAvroField(attr: SDKAttribute): Record<string, unknown> {
  const baseName = sanitizeAvroFieldName(attr.property);
  const nullableEnumName = `${EVENT_FORWARDER_AVRO_RECORD_NAME}_${baseName}_Enum`;

  const dt = attr.datatype as SDKAttributeType;

  switch (dt) {
    case "boolean":
      return {
        name: baseName,
        type: ["null", "boolean"],
        default: null,
        ...(attr.description ? { doc: attr.description } : {}),
      };
    case "string":
    case "secureString":
      return {
        name: baseName,
        type: ["null", "string"],
        default: null,
        ...(attr.description ? { doc: attr.description } : {}),
      };
    case "number":
      return {
        name: baseName,
        type: ["null", "double"],
        default: null,
        ...(attr.description ? { doc: attr.description } : {}),
      };
    case "enum": {
      const symbols = parseEnumSymbols(attr.enum);
      if (symbols && symbols.length > 0) {
        return {
          name: baseName,
          type: [
            "null",
            {
              type: "enum",
              name: nullableEnumName,
              symbols,
            },
          ],
          default: null,
          ...(attr.description ? { doc: attr.description } : {}),
        };
      }
      return {
        name: baseName,
        type: ["null", "string"],
        default: null,
        ...(attr.description ? { doc: attr.description } : {}),
      };
    }
    case "string[]":
      return {
        name: baseName,
        type: ["null", { type: "array", items: "string" }],
        default: null,
        ...(attr.description ? { doc: attr.description } : {}),
      };
    case "number[]":
      return {
        name: baseName,
        type: ["null", { type: "array", items: "double" }],
        default: null,
        ...(attr.description ? { doc: attr.description } : {}),
      };
    case "secureString[]":
      return {
        name: baseName,
        type: ["null", { type: "array", items: "string" }],
        default: null,
        ...(attr.description ? { doc: attr.description } : {}),
      };
    default: {
      const _exhaust: never = dt;
      throw new Error(`Unsupported SDK attribute datatype: ${_exhaust}`);
    }
  }
}

export function buildEventForwarderAvroSchema({
  attributeSchema = [],
}: {
  attributeSchema?: SDKAttributeSchema | undefined;
}): EventForwarderAvroRecordSchema {
  const baseFields: Record<string, unknown>[] =
    EVENT_FORWARDER_AVRO_DEFAULT_FIELDS.map((f) => {
      const { source: _s, ...avroField } = f;
      return avroField as Record<string, unknown>;
    });

  const seen = new Set(baseFields.map((bf) => bf.name as string));

  for (const attr of attributeSchema) {
    const avroField = sdkDatatypeToAvroField(attr);
    const fname = avroField.name as string;

    if (DEFAULT_FIELD_NAMES.has(fname) || seen.has(fname)) {
      throw new Error(
        `Event forwarder Avro: attribute "${attr.property}" maps to reserved or duplicate field name "${fname}"`,
      );
    }
    seen.add(fname);
    baseFields.push(avroField);
  }

  return {
    type: "record",
    name: EVENT_FORWARDER_AVRO_RECORD_NAME,
    namespace: EVENT_FORWARDER_AVRO_NAMESPACE,
    fields: baseFields,
  };
}

/** Summarize a registered Avro JSON schema for tests and debugging (not a full reverse to SDKAttribute). */
export function summarizeAvroRecordSchema(avroJson: unknown): {
  recordName?: string;
  namespace?: string;
  fieldNames: string[];
} {
  if (!avroJson || typeof avroJson !== "object") {
    return { fieldNames: [] };
  }

  const root = avroJson as Record<string, unknown>;
  if (root.type !== "record" || !Array.isArray(root.fields)) {
    return { fieldNames: [] };
  }

  return {
    recordName: typeof root.name === "string" ? root.name : undefined,
    namespace: typeof root.namespace === "string" ? root.namespace : undefined,
    fieldNames: root.fields
      .map((f) =>
        f && typeof f === "object" && "name" in f && typeof f.name === "string"
          ? f.name
          : null,
      )
      .filter((n): n is string => n != null),
  };
}
