---
name: add-event-forwarder-sink
description: >-
  Adds a new Confluent Cloud managed sink type to the GrowthBook event forwarder
  (BigQuery/Snowflake pattern). Use when adding Databricks Delta Lake, Redshift,
  or another DW sink, or when the user mentions event forwarder sink types,
  Confluent connector provisioning, or cc-*-sink connectors.
---

# Add Event Forwarder Confluent Sink

End-to-end checklist for a new warehouse sink. Reference implementations:
**BigQuery** (`BigQueryStorageSink`) and **Snowflake** (`SnowflakeSink`).

## Conventions

- **Sink dispatch**: always `switch (sinkType)` with `default` throwing
  `Unsupported event forwarder sink type: ...`. Never chain `? :` on sink type.
- **Optional connector config**: use `if (value?.trim()) { config[key] = value }`,
  not `...(cond ? { key: value } : {})`.
- **Exhaustiveness**: use `const _exhaust: never = sinkType` in `default` when
  TypeScript narrows the union.
- **Errors**: fail fast with descriptive messages; don't silently `return` for
  unknown sink types.

## Prerequisites

1. Read the Confluent Cloud sink docs (Configuration Properties + Quick Start):
   - [BigQuery Storage Sink V2](https://docs.confluent.io/cloud/current/connectors/cc-gcp-bigquery-storage-sink.html)
   - [Snowflake Sink](https://docs.confluent.io/cloud/current/connectors/cc-snowflake-sink/cc-snowflake-sink.html)
   - [Databricks Delta Lake Sink](https://docs.confluent.io/cloud/current/connectors/cc-databricks-delta-lake-sink/cc-databricks-delta-lake-sink.html) (AWS-only; S3 staging)
   - [Confluent Cloud connectors index](https://docs.confluent.io/cloud/current/connectors/index.html)
2. Confirm the connector supports **Avro + Schema Registry** (`input.data.format=AVRO`, `schema.context.name=default`) and **schema evolution** if org attributes change.
3. Note required IAM/role grants (see `SNOWFLAKE_SINK_STREAMING_SCHEMATIZATION_CONFIG` in `central-license-server/src/services/eventForwarderConfluent.ts`).

## Architecture (3 repos)

| Repo                       | Responsibility                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **growthbook**             | UI forms, Zod/types, datasource→sink mapping, license-server API calls, fact table + exposure queries, write-access tests |
| **central-license-server** | Confluent connector CRUD, Schema Registry, Kafka topics, connector config builder                                         |
| **growthbook-ingestor**    | Kafka topic routing (`DEDICATED_EVENT_TOPIC_SUFFIXES` — must stay in sync with license-server)                            |

Shared topic/table mapping lives in `central-license-server/src/services/eventForwarderConfluent.ts` (`DEDICATED_EVENT_TOPIC_SUFFIXES`, `buildTopic2TableMap`). Duplicate changes in `growthbook-ingestor/packages/ingestor/src/kafka.ts`.

## Checklist

```
- [ ] 1. Confluent docs: list required connector config keys + auth mode
- [ ] 2. shared/types/event-forwarder.d.ts — draft + stored config interfaces
- [ ] 3. shared/src/validators/event-forwarder-config.ts — sink enum
- [ ] 4. shared/src/validators/event-forwarder-access-test.ts — access test schema
- [ ] 5. back-end/eventForwarderConfig.ts — getEventForwarderSinkTypeForDatasource + buildNormalized* + sync validation
- [ ] 6. back-end/eventForwarderProvisioning.ts — provision / credentials / pause / resume branches
- [ ] 7. back-end/eventForwarderWriteAccessValidation.ts — write-access test (create/drop temp table)
- [ ] 8. back-end/controllers/datasources.ts — access-test endpoints (use switch helper)
- [ ] 9. back-end/enterprise/licenseUtil.ts — provision/teardown/credentials API payloads
- [ ] 10. front-end — *EventForwarderForm.tsx + ConnectionSettings wiring
- [ ] 11. central-license-server/types/event-forwarder-api.ts — Zod provision/credentials/teardown bodies
- [ ] 12. central-license-server/eventForwarderConfluent.ts:
        - CONNECTOR_CLASS constant
        - build*ConnectorConfig (export if tests need it)
        - ensure*Connector
        - provisionEventForwarderConfluent switch branches
        - updateEventForwarderConnectorCredentials switch overrides
        - teardownEventForwarderConfluent switch (no silent skip)
- [ ] 13. Tests: shared util, back-end services, central-license-server connector config unit tests
- [ ] 14. Fact tables: ensureEventForwarderEventsFactTable SQL dialect if needed
- [ ] 15. Manual: provision → attribute add → fact-table refresh → pause/resume → teardown
```

## central-license-server pattern

Mirror Snowflake (`buildSnowflakeConnectorConfig`, `ensureSnowflakeConnector`):

1. **Payload type** — e.g. `DatabricksSinkPayload` with fields from Confluent docs
2. **`buildXConnectorConfig`** — return `ConnectorConfig` with:
   - `connector.class`
   - `kafka.auth.mode` / `kafka.api.key` / `kafka.api.secret`
   - `topics` via `buildConnectorTopicsList(topic)`
   - `topic2table.map` via `buildTopic2TableMap(topic, catchAllTable)` (or sink-specific map)
   - Avro + schema context settings consistent with BigQuery/Snowflake
   - Schematization / auto-create settings from Confluent docs
3. **`ensureXConnector`** — wrap `ensureConnector({ desiredConfig: ... })`
4. **Provisioning validation** — `switch (input.sinkType)` with fail-fast checks per case
5. **Credential updates** — `switch` building overrides; optional fields via `if` blocks

Export sink-specific schematization constants (like `SNOWFLAKE_SINK_STREAMING_SCHEMATIZATION_CONFIG`) with doc comments linking Confluent + warehouse grant docs.

## growthbook pattern

1. **`getEventForwarderSinkTypeForDatasource`** — `case "<datasourceType>": return "<sinkType>"`
2. **Draft/stored config** — separate UI-editable fields from encrypted stored payload (credentials from datasource params at sync time)
3. **`buildNormalizedEventForwarderSinkPayloadForTest`** — validate required fields before license-server call
4. **Write access test** — use `testEventForwarderWriteAccessForSink` pattern in `datasources.ts` (switch, throw default)
5. **Fact table columns** — created with user id types only; full schema via `queueFactTableColumnsRefresh` after attribute changes

## Do NOT

- Re-add Avro schema building in GrowthBook shared (Schema Registry + connector schematization owns evolution)
- Leave a sink type in Zod/types without a full provision/teardown/credentials path
- Change `DEDICATED_EVENT_TOPIC_SUFFIXES` in only one repo
- Use chained `? :` for sink-type dispatch

## Verification

```bash
# growthbook
pnpm --filter shared test
pnpm --filter back-end test eventForwarder
pnpm type-check

# central-license-server
pnpm test eventForwarderConfluent
```

Provision a test forwarder in dev; add an org attribute; confirm Schema Registry evolution and warehouse table columns update.
