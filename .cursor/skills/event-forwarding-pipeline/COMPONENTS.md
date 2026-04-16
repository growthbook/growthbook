# Component Specifications

## Component 1: Schema Registry + Avro Topic

**Where:** `growthbook-ingestor/packages/ingestor/src/kafka.ts`

### What to change

Add Avro-encoded production to a **new** `enriched_events_avro` topic using
Confluent Schema Registry. The existing JSON production to `enriched_events`
remains unchanged (ClickHouse continues reading JSON as-is).

### Avro Schema (EnrichedEvent)

Register this as subject `enriched_events_avro-value` with BACKWARD compatibility:

```json
{
  "type": "record",
  "name": "EnrichedEvent",
  "namespace": "com.growthbook.events",
  "fields": [
    { "name": "event_uuid", "type": "string" },
    {
      "name": "timestamp",
      "type": { "type": "long", "logicalType": "timestamp-millis" }
    },
    {
      "name": "received_at",
      "type": { "type": "long", "logicalType": "timestamp-millis" }
    },
    { "name": "organization", "type": "string" },
    { "name": "datasource", "type": "string" },
    { "name": "client_key", "type": "string" },
    { "name": "event_name", "type": "string" },
    { "name": "environment", "type": ["null", "string"], "default": null },
    { "name": "user_id", "type": ["null", "string"], "default": null },
    { "name": "device_id", "type": ["null", "string"], "default": null },
    { "name": "session_id", "type": ["null", "string"], "default": null },
    { "name": "page_id", "type": ["null", "string"], "default": null },
    { "name": "sdk_language", "type": ["null", "string"], "default": null },
    { "name": "sdk_version", "type": ["null", "string"], "default": null },
    { "name": "ip", "type": ["null", "string"], "default": null },
    { "name": "geo_country", "type": ["null", "string"], "default": null },
    { "name": "geo_city", "type": ["null", "string"], "default": null },
    { "name": "geo_lat", "type": ["null", "double"], "default": null },
    { "name": "geo_lon", "type": ["null", "double"], "default": null },
    { "name": "ua", "type": ["null", "string"], "default": null },
    { "name": "ua_browser", "type": ["null", "string"], "default": null },
    { "name": "ua_os", "type": ["null", "string"], "default": null },
    { "name": "ua_device_type", "type": ["null", "string"], "default": null },
    { "name": "url", "type": ["null", "string"], "default": null },
    { "name": "url_path", "type": ["null", "string"], "default": null },
    { "name": "url_host", "type": ["null", "string"], "default": null },
    { "name": "url_query", "type": ["null", "string"], "default": null },
    { "name": "url_fragment", "type": ["null", "string"], "default": null },
    { "name": "page_title", "type": ["null", "string"], "default": null },
    { "name": "utm_source", "type": ["null", "string"], "default": null },
    { "name": "utm_medium", "type": ["null", "string"], "default": null },
    { "name": "utm_campaign", "type": ["null", "string"], "default": null },
    { "name": "utm_term", "type": ["null", "string"], "default": null },
    { "name": "utm_content", "type": ["null", "string"], "default": null },
    {
      "name": "properties",
      "type": "string",
      "doc": "JSON-encoded event properties"
    },
    {
      "name": "attributes",
      "type": "string",
      "doc": "JSON-encoded user attributes (context_json)"
    }
  ]
}
```

### Implementation notes

- Use `@kafkajs/confluent-schema-registry` package
- `context_json` (object) → `attributes` (JSON string) via `JSON.stringify()`
- `properties_json` (object) → `properties` (JSON string) via `JSON.stringify()`
- `timestamp` (Date) → epoch millis (long)
- New env vars: `SCHEMA_REGISTRY_URL`, `SCHEMA_REGISTRY_API_KEY`, `SCHEMA_REGISTRY_API_SECRET`
- New topic constant: `AVRO_TOPIC = "enriched_events_avro"`

### Dual-write implementation

```typescript
// In kafka.ts, after the existing JSON send:
// 1. Existing JSON write (unchanged)
await producer.send({
  topic: MAIN_TOPIC,
  messages: enrichedEvents.map((event) => ({
    value: JSON.stringify(event),
  })),
});

// 2. New Avro write (added)
await producer.send({
  topic: AVRO_TOPIC,
  messages: enrichedEvents.map((event) => ({
    value: await registry.encode(schemaId, toAvroPayload(event)),
  })),
});
```

### Schema tracker (for auto-materialization)

The ingestor also tracks the schema of `context_json` and `properties_json`
per organization. On each event, it observes the keys and inferred types:

```typescript
// Pseudocode — runs alongside event processing
function trackSchema(orgId: string, event: EnrichedEvent) {
  for (const [key, value] of Object.entries(event.context_json)) {
    upsertDiscoveredField(orgId, "attributes", key, inferType(value));
  }
  for (const [key, value] of Object.entries(event.properties_json)) {
    upsertDiscoveredField(orgId, "properties", key, inferType(value));
  }
}

function inferType(value: unknown): "string" | "number" | "boolean" | "skip" {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "skip"; // objects, arrays, null — don't auto-materialize
}
```

Storage options for discovered schemas:

- MongoDB collection `discovered_schemas` (simplest, back-end can read directly)
- Kafka compacted topic `schema_discoveries` (decoupled, but more infra)

Recommended: MongoDB for v1. The ingestor already fetches SDK info from the
back-end; it can POST discovered schema diffs to a new back-end endpoint.

---

## Component 2: Push Service (Kafka → Customer Buckets)

**Where:** Depends on chosen option (see Decision 11 in DECISIONS.md)

### Option A: Per-Customer Confluent GCS/S3 Sink Connectors

**Where:** `infra/terraform/modules/gcs-sink/` (updated for per-customer use)

Each customer gets a dedicated connector. The connector reads from the shared
`enriched_events_avro` topic, filters by organization (SMT), converts to Parquet,
and writes to the customer's own bucket.

```
infra/terraform/modules/
├── gcs-sink/          # Per-customer GCS Sink connector
│   ├── main.tf
│   ├── variables.tf
│   └── outputs.tf
└── s3-sink/           # Per-customer S3 Sink connector (new)
    ├── main.tf
    ├── variables.tf
    └── outputs.tf
```

#### GCS Sink per-customer config

```hcl
resource "confluent_connector" "gcs_sink" {
  environment { id = var.confluent_environment_id }
  kafka_cluster { id = var.kafka_cluster_id }

  config_nonsensitive = {
    "connector.class"   = "GcsSink"
    "name"              = "gcs-sink-${var.org_id}"
    "topics"            = var.source_topic

    "input.data.format"    = "AVRO"
    "output.data.format"   = "PARQUET"
    "gcs.bucket.name"      = var.customer_gcs_bucket
    "gcs.compression.codec" = "snappy"
    "time.interval"        = "HOURLY"
    "flush.size"           = tostring(var.flush_size)

    # Partition by date + hour only (no org prefix — bucket is single-tenant)
    "topics.dir"       = "data"
    "path.format"      = "'date='YYYY'-'MM'-'DD'/hour='HH"
    "partitioner.class" = "io.confluent.connect.storage.partitioner.TimeBasedPartitioner"
    "partition.duration.ms" = "3600000"
    "locale"           = "en-US"
    "timezone"         = "UTC"
    "timestamp.extractor" = "Record"

    "tasks.max" = "1"

    # SMT filter: only this org's events
    "transforms"                            = "filterOrg"
    "transforms.filterOrg.type"             = "io.confluent.connect.transforms.Filter$Value"
    "transforms.filterOrg.filter.condition" = "$.organization == '${var.org_id}'"
    "transforms.filterOrg.filter.type"      = "include"

    # DLQ
    "errors.tolerance"                              = "all"
    "errors.deadletterqueue.topic.name"             = "dlq-gcs-${var.org_id}"
    "errors.deadletterqueue.context.headers.enable" = "true"
  }

  config_sensitive = {
    "gcs.credentials.config" = var.customer_gcs_credentials_json
  }
}
```

#### S3 Sink per-customer config

```hcl
resource "confluent_connector" "s3_sink" {
  environment { id = var.confluent_environment_id }
  kafka_cluster { id = var.kafka_cluster_id }

  config_nonsensitive = {
    "connector.class"   = "S3_SINK"
    "name"              = "s3-sink-${var.org_id}"
    "topics"            = var.source_topic

    "input.data.format"    = "AVRO"
    "output.data.format"   = "PARQUET"
    "s3.bucket.name"       = var.customer_s3_bucket
    "s3.region"            = var.customer_s3_region
    "s3.compression.codec" = "snappy"
    "time.interval"        = "HOURLY"
    "flush.size"           = tostring(var.flush_size)

    # Partition by date + hour only (bucket is single-tenant)
    "topics.dir"       = "data"
    "path.format"      = "'date='YYYY'-'MM'-'DD'/hour='HH"
    "partitioner.class" = "io.confluent.connect.storage.partitioner.TimeBasedPartitioner"
    "partition.duration.ms" = "3600000"
    "locale"           = "en-US"
    "timezone"         = "UTC"
    "timestamp.extractor" = "Record"

    "tasks.max" = "1"

    # SMT filter: only this org's events
    "transforms"                            = "filterOrg"
    "transforms.filterOrg.type"             = "io.confluent.connect.transforms.Filter$Value"
    "transforms.filterOrg.filter.condition" = "$.organization == '${var.org_id}'"
    "transforms.filterOrg.filter.type"      = "include"

    # DLQ
    "errors.tolerance"                              = "all"
    "errors.deadletterqueue.topic.name"             = "dlq-s3-${var.org_id}"
    "errors.deadletterqueue.context.headers.enable" = "true"
  }

  config_sensitive = {
    "aws.access.key.id"     = var.customer_aws_access_key_id
    "aws.secret.access.key" = var.customer_aws_secret_access_key
  }
}
```

### Option B: Custom Consumer Service

**Where:** New service (e.g. `packages/event-forwarder/` or standalone repo)

A GrowthBook-managed Kafka consumer that reads from `enriched_events_avro`,
buffers events per org, and writes Parquet files to each customer's bucket.

```typescript
// Pseudocode for the custom consumer
interface ForwarderConfig {
  orgId: string;
  bucketType: "gcs" | "s3";
  bucketName: string;
  credentials: GCSCredentials | S3Credentials;
  flushIntervalMs: number; // e.g., 300_000 (5 min)
  flushSizeThreshold: number; // e.g., 10_000 events
}

// Consumer loop
for await (const batch of kafkaConsumer) {
  for (const event of batch) {
    const orgId = event.organization;
    orgBuffers[orgId].push(event);

    if (shouldFlush(orgBuffers[orgId])) {
      const parquet = serializeToParquet(orgBuffers[orgId]);
      const path = `data/date=${date}/hour=${hour}/events_${seq}.parquet`;
      await uploadToCustomerBucket(orgId, path, parquet);
      orgBuffers[orgId] = [];
    }
  }
}
```

Key requirements:

- Parquet serialization (use `parquet-wasm` or `apache-arrow` npm packages)
- Per-org buffering with flush on interval or size threshold
- Crash recovery: commit Kafka offsets only after successful upload
- Credential management: load per-org creds from MongoDB, cache in memory
- Health monitoring: track lag, upload failures, credential expiry

---

## Component 3: Forwarding Config + Credential Storage

**Where:** `packages/back-end/` and `packages/shared/`

### New types (in shared)

```typescript
// packages/shared/types/event-forwarding.d.ts

type ForwardingDestinationType = "bigquery" | "snowflake" | "databricks";

type ForwardingStorageType = "gcs" | "s3";

type ForwardingStatus = "active" | "paused" | "error" | "provisioning";

interface ForwardingDestination {
  id: string;
  organization: string;
  destinationType: ForwardingDestinationType;
  storageType: ForwardingStorageType;
  status: ForwardingStatus;
  // Encrypted bucket write credentials (same encryption pattern as DataSource.params)
  bucketParams: string;
  // Encrypted DW credentials for DDL execution (view creation)
  dwParams: string;
  // Bucket URI (e.g., "gs://customer-bucket" or "s3://customer-bucket")
  bucketUri: string;
  // Connector ID in Confluent Cloud (Option A only)
  connectorId?: string;
  // DLQ topic name
  dlqTopic?: string;
  dateCreated: Date;
  dateUpdated: Date;
  lastError?: string;
  lastErrorDate?: Date;
  lastPushAt?: Date;
  lastViewRebuildAt?: Date;
}

// Discovered schema fields (auto-materialization)
interface DiscoveredSchemaField {
  organization: string;
  source: "attributes" | "properties";
  fieldName: string;
  inferredType: "string" | "number" | "boolean";
  firstSeen: Date;
  lastSeen: Date;
  eventCount: number;
  materialized: boolean;
  userRemoved: boolean;
}

// Bucket write credential shapes (decrypted)
interface GCSBucketParams {
  bucketName: string;
  serviceAccountKeyJson: string;
}

interface S3BucketParams {
  bucketName: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  // Alternative: cross-account role ARN (preferred for production)
  roleArn?: string;
}

// DW credential shapes for DDL execution (decrypted)
interface BigQueryDWParams {
  projectId: string;
  dataset: string;
  serviceAccountKeyJson: string;
}

interface SnowflakeDWParams {
  accountUrl: string;
  database: string;
  schema: string;
  role: string;
  user: string;
  privateKey: string;
}

interface DatabricksDWParams {
  host: string;
  httpPath: string;
  token: string;
  catalog?: string;
  schema?: string;
}
```

### Model

Create `ForwardingDestinationModel` using `MakeModelClass()` pattern (see CLAUDE.md BaseModel section).

- Collection: `forwardingdestinations`
- ID prefix: `fwd_`
- Permission: tied to `manageDatasources` or a new `manageForwarding` permission

Create `DiscoveredSchemaModel` for auto-materialization tracking.

- Collection: `discoveredschemas`
- Compound index on `(organization, source, fieldName)`

### API endpoints (internal, for front-end)

| Method | Path                                    | Action                                                         |
| ------ | --------------------------------------- | -------------------------------------------------------------- |
| GET    | `/forwarding`                           | List forwarding destinations for org                           |
| POST   | `/forwarding`                           | Create new forwarding destination                              |
| PUT    | `/forwarding/:id`                       | Update credentials or config                                   |
| DELETE | `/forwarding/:id`                       | Disable and tear down                                          |
| POST   | `/forwarding/:id/test`                  | Test DW connection                                             |
| GET    | `/forwarding/:id/errors`                | Get recent DLQ errors                                          |
| POST   | `/forwarding/:id/retry`                 | Retry failed events from DLQ                                   |
| GET    | `/forwarding/schema`                    | Get discovered schema fields for org                           |
| POST   | `/forwarding/schema/:fieldName/remove`  | Mark field as user-removed (exclude from auto-materialization) |
| POST   | `/forwarding/schema/:fieldName/restore` | Restore a user-removed field                                   |
| POST   | `/forwarding/schema/ingest`             | Ingestor posts discovered schema diffs                         |

---

## Component 4: DW Adapter (External Table + Views) + Auto-Materialization

**Where:** `packages/back-end/src/services/forwarding/`

### Interface

```typescript
// packages/back-end/src/services/forwarding/adapter.ts

interface WarehouseForwardingAdapter {
  testConnection(
    dwParams: unknown,
  ): Promise<{ success: boolean; error?: string }>;

  // Create the external table pointing at the customer's bucket
  createExternalTable(
    dwParams: unknown,
    bucketUri: string,
    storageType: "gcs" | "s3",
  ): Promise<void>;

  // Create the 3 views (events, experiment_views, feature_usage)
  createViews(
    dwParams: unknown,
    materializedColumns: MaterializedColumn[],
  ): Promise<void>;

  // Recreate views with updated column list
  // Uses CREATE OR REPLACE — atomic, retroactive, no data loss
  updateViews(
    dwParams: unknown,
    materializedColumns: MaterializedColumn[],
  ): Promise<void>;

  // Drop external table and all views (teardown on disable)
  teardown(dwParams: unknown): Promise<void>;
}
```

### External table setup (per DW)

Unlike the Confluent DW Sink approach (where the connector auto-creates a
native landing table), the object storage approach requires GrowthBook to
create an external table in the customer's DW that points at their bucket.

See POC SQL scripts in `infra/poc/` for exact DDL per DW:

- BigQuery: `CREATE EXTERNAL TABLE` with hive partitioning (date, hour)
- Snowflake: Storage integration + external stage + external table
- Databricks: External location + external table via Unity Catalog

The `properties` and `attributes` columns are `STRING`/`TEXT` containing
the full JSON blobs. These are the source for auto-materialized column extraction.

### Auto-materialization orchestration

```typescript
// packages/back-end/src/services/forwarding/auto-materialize.service.ts

async function reconcileSchema(orgId: string): Promise<void> {
  // 1. Load discovered schema fields (not user-removed, not yet materialized)
  const newFields = await DiscoveredSchemaModel.find({
    organization: orgId,
    materialized: false,
    userRemoved: false,
  });

  if (newFields.length === 0) return;

  // 2. Check column budget
  const currentCount = await DiscoveredSchemaModel.countDocuments({
    organization: orgId,
    materialized: true,
  });
  const budget = MAX_AUTO_COLUMNS - currentCount;
  const fieldsToAdd = newFields.slice(0, budget);

  if (fieldsToAdd.length === 0) return;

  // 3. Convert to MaterializedColumn format
  const newColumns: MaterializedColumn[] = fieldsToAdd.map((f) => ({
    columnName: sanitizeColumnName(f.fieldName),
    sourceField: f.fieldName,
    datatype: mapInferredType(f.inferredType),
    source: f.source,
  }));

  // 4. Merge with existing materialized columns
  const existingColumns = await getExistingMaterializedColumns(orgId);
  const allColumns = [...existingColumns, ...newColumns];

  // 5. Update all forwarding destinations for this org
  const destinations = await ForwardingDestinationModel.find({
    organization: orgId,
    status: "active",
  });

  for (const dest of destinations) {
    const adapter = getAdapter(dest.destinationType);
    const dwParams = decryptParams(dest.dwParams);
    await adapter.updateViews(dwParams, allColumns);
  }

  // 6. Mark fields as materialized
  await DiscoveredSchemaModel.updateMany(
    { _id: { $in: fieldsToAdd.map((f) => f._id) } },
    { $set: { materialized: true } },
  );
}
```

### View DDL (Standard VIEWs over external tables)

All DWs use standard VIEWs (not materialized views or dynamic tables) because
the base table is an external table. Views are always current, have no storage
cost, and are atomic to replace.

No `WHERE organization = ...` filter is needed — each customer's bucket is
single-tenant, so the external table only contains that org's events.

See full DDL in POC scripts: `infra/poc/bigquery/`, `infra/poc/snowflake/`,
`infra/poc/databricks/`.

#### BigQuery (example: events view)

```sql
CREATE OR REPLACE VIEW `{dataset}.events` AS
SELECT
  event_uuid, timestamp, received_at, client_key, event_name,
  environment, user_id, device_id, session_id,
  sdk_language, sdk_version, ip, geo_country, geo_city,
  properties, attributes,
  -- auto-materialized columns from attributes (appended by adapter)
  JSON_VALUE(attributes, '$.{col.sourceField}') AS {col.columnName},
  -- auto-materialized columns from properties
  JSON_VALUE(properties, '$.{col.sourceField}') AS {col.columnName},
  date, hour
FROM `{dataset}.raw_events`
WHERE event_name NOT IN ('Experiment Viewed', 'Feature Evaluated');
```

#### Snowflake (example: events view)

```sql
CREATE OR REPLACE VIEW events AS
SELECT
  event_uuid, timestamp, received_at, client_key, event_name,
  environment, user_id, device_id, session_id,
  sdk_language, sdk_version, ip, geo_country, geo_city,
  properties, attributes,
  -- auto-materialized from attributes
  PARSE_JSON(attributes):{col.sourceField}::VARCHAR AS {col.columnName},
  -- auto-materialized from properties
  PARSE_JSON(properties):{col.sourceField}::VARCHAR AS {col.columnName},
  date, hour
FROM raw_events
WHERE event_name NOT IN ('Experiment Viewed', 'Feature Evaluated');
```

#### Databricks (example: events view)

```sql
CREATE OR REPLACE VIEW events AS
SELECT
  event_uuid, from_unixtime(timestamp / 1000) AS event_timestamp,
  from_unixtime(received_at / 1000) AS received_at,
  client_key, event_name,
  environment, user_id, device_id, session_id,
  sdk_language, sdk_version, ip, geo_country, geo_city,
  properties, attributes,
  -- auto-materialized from attributes
  get_json_object(attributes, '$.{col.sourceField}') AS {col.columnName},
  -- auto-materialized from properties
  get_json_object(properties, '$.{col.sourceField}') AS {col.columnName},
  date, hour
FROM raw_events
WHERE event_name NOT IN ('Experiment Viewed', 'Feature Evaluated');
```

### Adapter implementations

```
packages/back-end/src/services/forwarding/
├── adapter.ts                        # Interface definition
├── bigquery.adapter.ts               # BigQuery implementation
├── snowflake.adapter.ts              # Snowflake implementation
├── databricks.adapter.ts             # Databricks implementation
├── forwarding.service.ts             # Orchestration (setup, update, teardown)
├── auto-materialize.service.ts       # Schema reconciliation + view rebuilds
└── ddl-generators/
    ├── bigquery.ddl.ts               # BigQuery DDL string builders
    ├── snowflake.ddl.ts              # Snowflake DDL string builders
    └── databricks.ddl.ts             # Databricks DDL string builders
```

---

## Component 5: Monitoring + View Reconciliation

**Where:** `packages/back-end/src/services/forwarding/`

### What to monitor

```
Push pipeline health:
  ├── Kafka consumer lag (if custom consumer) or connector status (if Confluent)
  ├── Last successful push timestamp per org
  ├── Upload failures (credential expiry, bucket access denied, quota exceeded)
  ├── Parquet file count and size per org per day
  └── Alert on: no push for >30 min, repeated failures, credential near-expiry

Schema reconciliation:
  ├── Periodic job (e.g., every 5 minutes) compares discovered vs materialized
  ├── On drift: rebuild views via CREATE OR REPLACE
  ├── Track: last reconciliation time, columns added, rebuild success/failure
  └── Alert on: rebuild failure, column budget exceeded

View health:
  ├── Periodic validation query on each customer's DW (e.g., SELECT COUNT(*))
  ├── Detect: external table broken (bucket access revoked), view stale
  └── Alert on: view query failure, external table access denied
```

### Reconciliation service

```typescript
// packages/back-end/src/services/forwarding/reconciliation.service.ts

async function reconcileAllOrgs(): Promise<void> {
  const activeOrgs = await ForwardingDestinationModel.distinct("organization", {
    status: "active",
  });

  for (const orgId of activeOrgs) {
    try {
      await reconcileSchema(orgId);
      await validateViews(orgId);
    } catch (e) {
      logger.error({ orgId, error: e }, "Forwarding reconciliation failed");
      await recordForwardingError(orgId, e);
    }
  }
}

// Run on a schedule (e.g., every 5 minutes via cron job or Bull queue)
```

---

## Component 6: DLQ + Error Surfacing

### DLQ Architecture

```
Confluent Sink fails to write to DW
  → Record sent to DLQ topic (dlq-{dw_type}-{org_id})
  → DLQ consumer (back-end service or lambda)
  → Stores error metadata in MongoDB
  → Optionally archives raw event to S3

Front-end:
  → Forwarding settings page shows error count + last error
  → "View errors" shows recent failures with details
  → "Retry" button replays from S3/DLQ back to sink topic
```

### DLQ topic naming

```
dlq-bq-{org_id}       # BigQuery sink failures
dlq-sf-{org_id}       # Snowflake sink failures
dlq-db-{org_id}       # Databricks sink failures
```

### Error metadata model

```typescript
interface ForwardingError {
  id: string;
  organization: string;
  forwardingDestinationId: string;
  timestamp: Date;
  errorMessage: string;
  errorCode?: string;
  eventUuid?: string;
  // S3 key for the raw event payload (for retry)
  s3Key?: string;
  retried: boolean;
  retriedAt?: Date;
}
```

### Common error categories to surface

| Error                  | User action needed                                            |
| ---------------------- | ------------------------------------------------------------- |
| Authentication failure | Update DW credentials                                         |
| Permission denied      | Grant write permissions to service account                    |
| Quota exceeded         | Increase DW quota or pause forwarding                         |
| Table not found        | Re-run setup (recreate landing table)                         |
| Schema mismatch        | Usually transient; retry. If persistent, recreate tables      |
| Network timeout        | Usually transient; auto-retry. If persistent, check DW status |
