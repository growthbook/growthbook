import {
  buildEventForwarderAvroSchema,
  EVENT_FORWARDER_AVRO_DEFAULT_FIELDS,
  EVENT_FORWARDER_AVRO_NAMESPACE,
  EVENT_FORWARDER_AVRO_RECORD_NAME,
  sanitizeAvroFieldName,
  summarizeAvroRecordSchema,
} from "../src/event-forwarder-avro";

describe("eventForwarderAvro", () => {
  it("exports a fixed number of default base fields", () => {
    expect(EVENT_FORWARDER_AVRO_DEFAULT_FIELDS.length).toBe(17);
  });

  it("buildEventForwarderAvroSchema merges defaults only when attributeSchema empty", () => {
    const schema = buildEventForwarderAvroSchema({});
    expect(schema.type).toBe("record");
    expect(schema.name).toBe(EVENT_FORWARDER_AVRO_RECORD_NAME);
    expect(schema.namespace).toBe(EVENT_FORWARDER_AVRO_NAMESPACE);
    expect(schema.fields).toHaveLength(
      EVENT_FORWARDER_AVRO_DEFAULT_FIELDS.length,
    );
  });

  it("appends SDK attribute fields with null defaults", () => {
    const schema = buildEventForwarderAvroSchema({
      attributeSchema: [
        {
          property: "plan_tier",
          datatype: "string",
        },
      ],
    });
    expect(schema.fields).toHaveLength(
      EVENT_FORWARDER_AVRO_DEFAULT_FIELDS.length + 1,
    );
    const last = schema.fields[schema.fields.length - 1] as Record<
      string,
      unknown
    >;
    expect(last.name).toBe("plan_tier");
    expect(last.type).toEqual(["null", "string"]);
    expect(last.default).toBeNull();
  });

  it("throws when an SDK attribute collides with a reserved default name", () => {
    expect(() =>
      buildEventForwarderAvroSchema({
        attributeSchema: [{ property: "event_name", datatype: "string" }],
      }),
    ).toThrow(/reserved or duplicate field name "event_name"/);
  });

  it("skips archived attributes", () => {
    const schema = buildEventForwarderAvroSchema({
      attributeSchema: [
        {
          property: "gone",
          datatype: "string",
          archived: true,
        },
      ],
    });
    expect(schema.fields).toHaveLength(
      EVENT_FORWARDER_AVRO_DEFAULT_FIELDS.length,
    );
  });

  it("sanitizeAvroFieldName strips invalid characters", () => {
    expect(sanitizeAvroFieldName("$groups")).toBe("_groups");
    expect(sanitizeAvroFieldName("foo-bar")).toBe("foo_bar");
  });

  it("summarizeAvroRecordSchema extracts metadata from built schema JSON", () => {
    const schema = buildEventForwarderAvroSchema({});
    const parsed = JSON.parse(JSON.stringify(schema)) as unknown;
    const summary = summarizeAvroRecordSchema(parsed);
    expect(summary.recordName).toBe(EVENT_FORWARDER_AVRO_RECORD_NAME);
    expect(summary.namespace).toBe(EVENT_FORWARDER_AVRO_NAMESPACE);
    expect(summary.fieldNames).toContain("event_name");
    expect(summary.fieldNames).toContain("attributes");
    expect(summary.fieldNames.length).toBe(
      EVENT_FORWARDER_AVRO_DEFAULT_FIELDS.length,
    );
  });

  it("summarizeAvroRecordSchema returns empty for invalid input", () => {
    expect(summarizeAvroRecordSchema(null)).toEqual({ fieldNames: [] });
    expect(summarizeAvroRecordSchema({ type: "not-record" })).toEqual({
      fieldNames: [],
    });
  });
});
