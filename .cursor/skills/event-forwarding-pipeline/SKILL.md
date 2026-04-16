---
name: event-forwarding-pipeline
description: >-
  Implement the GrowthBook event forwarding pipeline that delivers enriched SDK
  events from Kafka to customer-owned object storage (GCS, S3) and data
  warehouses (BigQuery, Snowflake, Databricks). Use when working on event
  forwarding, object storage push, auto-materialized views, schema evolution,
  or the Confluent BigQuery sink.
---

# Event Forwarding Pipeline

## Architecture Overview

```
SDK → Ingestor (enrich) → Kafka (enriched_events) ─┬→ ClickHouse (existing, unchanged)
                                                    └→ [Forwarding] → Customer Storage → Customer DW
```

Events always flow to managed ClickHouse via the existing JSON pipeline (unchanged).
Forwarding to customer-owned storage and data warehouses is opt-in per org.
Two delivery approaches are supported (can coexist):

1. **Object Storage** — Push events as Parquet to customer-owned GCS/S3 buckets;
   customer DWs query via external tables + materialized views managed by GrowthBook.
2. **Confluent BigQuery Sink** — Direct streaming into customer-owned BigQuery
   via Confluent connector (to be planned separately).

**Scope boundary:** The ClickHouse ingestion pipeline is out of scope for this work.
It continues to consume the existing `enriched_events` JSON topic as-is. The
forwarding pipeline produces to a new `enriched_events_avro` topic and manages
its own DW-side schema independently.

### Key Design Decisions

| Decision                   | Choice                                                        | Rationale                                                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage ownership          | Customer-owned buckets (GCS/S3)                               | Customer controls their data; no cross-org isolation concerns                                                                                                                                                                                                   |
| Credential flow            | Customer gives GrowthBook write creds                         | GrowthBook pushes to their bucket; customer already has read access                                                                                                                                                                                             |
| Supported storage          | GCS + S3                                                      | Covers BigQuery (GCS), Snowflake (GCS or S3), Databricks (S3)                                                                                                                                                                                                   |
| DW materialization         | Views managed by GrowthBook                                   | 3 views per org (events, experiment_views, feature_usage)                                                                                                                                                                                                       |
| View type                  | Standard VIEWs over external tables                           | MVs not supported over external tables; VIEWs are always current                                                                                                                                                                                                |
| ClickHouse impact          | None — out of scope                                           | Forwarding is additive, CH pipeline unchanged                                                                                                                                                                                                                   |
| Kafka topic                | New `enriched_events_avro` topic                              | Avro for DW sinks; existing JSON topic untouched                                                                                                                                                                                                                |
| Column discovery           | Auto from JSON blobs                                          | Ingestor tracks schema per org; views rebuilt on drift                                                                                                                                                                                                          |
| Column removal             | Never auto-remove                                             | Only auto-add; users explicitly remove unwanted columns                                                                                                                                                                                                         |
| Data loss on remove/re-add | None                                                          | Views use CREATE OR REPLACE over immutable Parquet files                                                                                                                                                                                                        |
| Confluent BigQuery Sink    | Planned separately                                            | Direct streaming for customers who need low-latency BigQuery                                                                                                                                                                                                    |
| Avro schema management     | Register from code (POC); MongoDB per-connection (production) | POC: hardcoded schema in `kafka.ts`, idempotent register on startup. Production: store field mapping per ForwardingDestination in MongoDB so each connection can evolve independently. Ingestor fetches mapping at runtime and builds Avro payload dynamically. |

## Object Storage Approach (Primary)

```
SDK → Ingestor → Kafka (enriched_events_avro) → Push Service → Customer Bucket (GCS/S3)
                                                                  ↓
                                                           Customer DW (external table)
                                                                  ↓
                                                           Views (managed by GrowthBook)
```

Customers set up their own GCS or S3 bucket and provide GrowthBook write
credentials. GrowthBook pushes enriched events as Parquet files, partitioned
by `date` and `hour`. Since each bucket is single-tenant (one org per bucket),
no `organization` partition is needed.

GrowthBook then creates and maintains materialized views on the customer's DW,
monitors the push pipeline, and rebuilds views when schema changes are detected.

### Push Mechanism Options

Three options for getting events from Kafka to customer-owned buckets.
See [COST-ANALYSIS-OBJECT-STORAGE.md](COST-ANALYSIS-OBJECT-STORAGE.md) for
detailed pricing.

| Option                                | Monthly Cost (50 orgs) | Latency    | Build Effort              | Ops Burden            |
| ------------------------------------- | ---------------------- | ---------- | ------------------------- | --------------------- |
| A: Per-customer Confluent GCS/S3 Sink | ~$1,133                | ~5-15 min  | Low (config only)         | O(N) connectors       |
| B: Custom consumer service            | ~$200-400              | ~5-15 min  | High (build from scratch) | O(1) service          |
| C: Hybrid (staging bucket + sync)     | ~$235                  | ~10-30 min | Medium (sync service)     | O(1) + staging bucket |

### Bucket Path Structure

Since each customer has their own bucket, paths are simple:

```
s3://customer-bucket/data/date=2025-04-15/hour=14/events_00000.parquet
s3://customer-bucket/data/date=2025-04-15/hour=15/events_00001.parquet
gs://customer-bucket/data/date=2025-04-15/hour=14/events_00000.parquet
```

No `organization=` prefix needed — the bucket itself provides org isolation.

### Schema Evolution & Data Loss Guarantees

The `properties` and `attributes` columns land as JSON strings in every Parquet
file. Auto-materialized columns are `JSON_VALUE()` extractions in views, not
physical columns in the Parquet data. This makes schema changes safe:

**Adding a materialized column (auto or manual):**

1. Ingestor detects new field in `properties` or `attributes` JSON
2. Back-end runs `CREATE OR REPLACE VIEW` adding `JSON_VALUE(properties, '$.newField')`
3. New column retroactively extracts values from ALL historical Parquet files
4. Zero data loss, no backfill needed

**Removing a materialized column (manual only, never auto-remove):**

1. `CREATE OR REPLACE VIEW` without the column
2. Raw Parquet files still contain the JSON blob with that field
3. Re-adding later retroactively restores all historical values
4. Zero data loss

**Avro schema evolution (adding a top-level field):**

1. Schema Registry updated (new nullable field, backward-compatible)
2. New Parquet files contain the field; old files return NULL for it
3. All DWs handle missing columns in Parquet as NULL natively

**Avro schema evolution (removing a top-level field):**

1. Old Parquet files still have the field (old data preserved)
2. New Parquet files don't have the field (new rows = NULL)
3. No data loss in existing files — Parquet is immutable

**Type conflict resolution:**

- Same field seen with different types → widen to STRING (safe default)
- Users can cast in their own queries

### Avro Schema Management Strategy

**POC (current):** The Avro schema is hardcoded in `kafka.ts`. On startup the
ingestor registers it with Confluent Schema Registry (idempotent — returns the
existing ID if unchanged). `toAvroPayload()` maps `EnrichedEvent` fields to the
Avro record. This keeps the POC self-contained with no external dependencies.

**Production plan:** Store the field mapping per `ForwardingDestination` in
MongoDB. Each connection document holds the list of top-level fields + their
Avro types. The ingestor fetches the mapping at runtime (cached, refreshed on
change) and builds the Avro payload dynamically. Benefits:

- Per-org schema evolution — one org can add a field without affecting others
- Schema changes are a data update (MongoDB write + view rebuild), not a code deploy
- Aligns with the auto-materialization flow: when a new field is discovered and
  materialized, the MongoDB mapping is updated and the Avro payload picks it up
  on the next produce cycle
- The fixed top-level fields (event_uuid, timestamp, organization, etc.) remain
  constant; only the `properties`/`attributes` JSON extraction columns vary

```
ForwardingDestination (MongoDB)
  ├── id, organization, destinationType, storageType, ...
  └── avroFieldMapping: [                          ← new field (production)
        { name: "event_uuid", type: "string", source: "top-level" },
        { name: "custom_plan", type: "string", source: "attributes.plan" },
        ...
      ]
```

## Component Map

There are 6 components to implement. For detailed specs, see [COMPONENTS.md](COMPONENTS.md).

| #   | Component                                                  | Where                               | New/Modify                     |
| --- | ---------------------------------------------------------- | ----------------------------------- | ------------------------------ |
| 1   | Schema Registry + Avro topic                               | growthbook-ingestor                 | Modify `kafka.ts` (dual-write) |
| 2   | Push service (Kafka → customer buckets)                    | New service or Confluent connectors | New                            |
| 3   | Forwarding config + credential storage                     | back-end                            | New model + API                |
| 4   | DW adapter (external table + views) + auto-materialization | back-end                            | New service                    |
| 5   | Monitoring + view reconciliation                           | back-end                            | New                            |
| 6   | DLQ + error surfacing                                      | back-end + front-end                | New                            |

## Implementation Order

Follow this sequence. Each phase is independently deployable.

### Phase 1: Foundation (No customer-visible changes)

```
1. Schema Registry integration in ingestor
   └→ Dual-write: keep existing JSON to enriched_events (for ClickHouse)
   └→ Produce Avro-encoded events to new enriched_events_avro topic
   └→ Register fixed EnrichedEvent Avro schema
   └→ Zero impact on existing ClickHouse pipeline

2. Push service or per-customer connector setup
   └→ Option A: Terraform modules for per-customer GCS/S3 Sink connectors
   └→ Option B: Custom consumer service (Kafka → Parquet → customer bucket)
   └→ Option C: Single GCS Sink to staging bucket + sync service
   └→ Validate Parquet output with test bucket
```

### Phase 2: Customer-Facing MVP

```
3. Forwarding config + credential storage
   └→ New ForwardingDestination model (not extending DataSource)
   └→ Encrypted credential storage: bucket write creds + DW DDL creds
   └→ API endpoints: enable/disable forwarding, store credentials, test connection
   └→ Customer provides: bucket URI, write credentials, DW credentials

4. DW adapter service + auto-materialization
   └→ WarehouseForwardingAdapter interface
   └→ BigQuery, Snowflake, Databricks implementations
   └→ External table creation (pointing at customer's bucket)
   └→ Auto-materialized view creation (3 views per org)
   └→ Schema tracker: discover fields from JSON blobs, auto-add columns
   └→ CREATE OR REPLACE views on schema drift (no data loss, retroactive)
```

### Phase 3: Reliability & Monitoring

```
5. Monitoring + view reconciliation
   └→ Monitor push pipeline health (lag, errors, delivery confirmation)
   └→ Periodic schema reconciliation (compare discovered vs materialized)
   └→ Auto-rebuild views when schema drift detected
   └→ Alert on push failures, credential expiry, bucket access issues

6. DLQ + error surfacing
   └→ Failed events to DLQ (S3 or Kafka DLQ topic)
   └→ Back-end: poll/read DLQ, store error metadata
   └→ Front-end: surface errors on forwarding settings page
   └→ Retry mechanism
```

### Future: Confluent BigQuery Sink (To Be Planned)

```
Direct streaming into customer-owned BigQuery via Confluent connector.
Lower latency than object storage approach for BigQuery customers.
Will be planned and documented separately.
```

## Branching Decisions

Use this decision tree when implementing. For full details see [DECISIONS.md](DECISIONS.md).

### Which push mechanism?

```
Need Confluent-managed delivery with minimal custom code?
  YES → Option A: Per-customer GCS/S3 Sink connectors
  NO  → Is staging bucket latency acceptable (~10-30 min)?
          YES → Option C: Hybrid (staging + sync, cheapest Confluent cost)
          NO  → Option B: Custom consumer (fixed cost, full control)
```

### Which materialization strategy per DW?

```
All DWs → Standard VIEW over external table
  ├── BigQuery:    VIEW with JSON_VALUE() extractions
  ├── Snowflake:   VIEW with PARSE_JSON() extractions
  └── Databricks:  VIEW with get_json_object() extractions

Materialized views / dynamic tables are NOT supported over external tables.
Standard VIEWs are always current, no extra storage, and atomic to replace.
```

### How does auto-materialization work?

```
1. Ingestor-side schema tracker observes keys in properties/attributes JSON
   per org, storing { field, inferredType, firstSeen, lastSeen, eventCount }
2. On new field detected (or on periodic reconciliation):
   a. Compare discovered schema to current materialized columns in MongoDB
   b. If new fields found → add columns, rebuild views via CREATE OR REPLACE
   c. Never auto-remove columns (only auto-add)
3. User can explicitly remove unwanted columns from the UI
   a. View is rebuilt without that column
   b. Parquet files untouched (data recoverable by re-adding)
4. Type conflicts resolved by widening to STRING (safe default)
5. Column budget enforced (e.g., max 200 auto-materialized columns per org)
```

### When a materialized column is added (auto or manual):

```
1. Save column to MongoDB (discovered_schemas or MaterializedColumn)
2. For each forwarding destination for this org:
   a. Determine DW type
   b. Call adapter.updateViews(credentials, columns)
   c. Adapter runs CREATE OR REPLACE VIEW with DW-specific SQL
3. Historical data retroactively available (views extract from JSON in Parquet)
4. No data loss — Parquet files are append-only and immutable
```

### When a materialized column is removed (manual only):

```
Same as add — recreate the view WITHOUT the removed column.
Raw Parquet files still have the value in the JSON blob.
Re-adding the column later retroactively restores all historical values.
Zero data loss at any point.
```

## Key File Locations

| Purpose                           | Path                                                 |
| --------------------------------- | ---------------------------------------------------- |
| DataSource types                  | `packages/shared/types/datasource.d.ts`              |
| MaterializedColumn type           | `packages/shared/types/datasource.d.ts` (line ~280)  |
| Fact table column types           | `packages/shared/types/fact-table.d.ts`              |
| Ingestor Kafka producer           | `growthbook-ingestor/packages/ingestor/src/kafka.ts` |
| Ingestor event types              | `growthbook-ingestor/packages/ingestor/src/data.ts`  |
| BigQuery POC (SQL scripts)        | `infra/poc/bigquery/`                                |
| Snowflake POC (SQL scripts)       | `infra/poc/snowflake/`                               |
| Databricks POC (SQL scripts)      | `infra/poc/databricks/`                              |
| GCS Sink per-customer (Terraform) | `infra/terraform/modules/gcs-sink/`                  |

## Additional Resources

- [COMPONENTS.md](COMPONENTS.md) — Detailed specs for each component
- [DECISIONS.md](DECISIONS.md) — Full decision tree with trade-off analysis
- [COST-ANALYSIS-OBJECT-STORAGE.md](COST-ANALYSIS-OBJECT-STORAGE.md) — Cost comparison for push mechanism options
