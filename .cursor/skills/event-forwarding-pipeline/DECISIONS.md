# Decision Tree & Trade-Off Analysis

## Decision 1: Kafka Topic Strategy for DW Forwarding

### Context

The existing ingestor produces JSON to `enriched_events`, consumed by ClickHouse.
The DW forwarding pipeline needs Avro for Confluent Sink connectors. The ClickHouse
pipeline is out of scope and must not be disrupted.

### Decision

**Dual-write to a new Avro topic.** The ingestor writes to both:

- `enriched_events` — JSON (existing, for ClickHouse, unchanged)
- `enriched_events_avro` — Avro with Schema Registry (new, for DW sinks)

### Rationale

```
Pro: Zero risk to existing ClickHouse pipeline
Pro: Can be deployed incrementally
Pro: Avro topic is purpose-built for Confluent Sink connectors
Pro: Schema Registry enforces backward compatibility for DW consumers
Con: Double Kafka write throughput from ingestor
Con: Two topics to manage
```

The throughput cost is acceptable at current scale (~385 eps). If the team later
wants to converge to a single Avro topic, that's a separate ClickHouse migration
project outside the forwarding pipeline scope.

---

## Decision 2: Shared Topic vs Per-Org Topics

### Decision criteria

| Metric                       | Threshold for per-org topics |
| ---------------------------- | ---------------------------- |
| Forwarding org count         | > 50                         |
| Events per second (total)    | > 5,000                      |
| Per-connector Confluent cost | Becomes material (>$10K/mo)  |

### Cost analysis at 1B events/month (~385 eps)

#### Shared topic (Phase 1)

```
Assumptions: 50 forwarding orgs, 385 eps average

Each connector reads full topic: 385 eps × 50 connectors = 19,250 eps total reads
Each connector processes: 385/50 ≈ 7.7 eps net (rest filtered by SMT)

Confluent cost:
  Connectors: 50 × ~$0.11/hr = $5.50/hr = ~$4,000/month
  Cluster read bandwidth: 19,250 eps × avg 1KB = ~19 MB/s additional read
  This is within a standard CKU's capacity

Total incremental: ~$4,000-6,000/month
```

#### Per-org topics (Phase 2)

```
Fan-out service: reads 385 eps, writes 385 eps (split across 50 topics)
Each connector reads only its org: 7.7 eps each, 385 eps total across all

Confluent cost:
  Connectors: 50 × ~$0.11/hr = $5.50/hr = ~$4,000/month (same)
  Fan-out compute: ~$200-500/month (small Kafka Streams app)
  Cluster bandwidth: 385 + 385 + 385 = 1,155 eps (vs 19,250 with shared)
  50 additional topics: ~$50/month on Confluent Cloud

Total incremental: ~$4,500-5,000/month (cheaper cluster bandwidth)
```

#### Break-even

Per-org topics become clearly better when read amplification exceeds cluster
capacity or cost threshold. At 50 orgs this is marginal. At 200+ orgs or
5K+ eps, per-org topics are strongly preferred.

---

## Decision 3: Materialization Strategy per DW

### BigQuery

```
Option A: Materialized View (CREATE MATERIALIZED VIEW ... AS SELECT)
  ├── Pro: Auto-refreshed by BigQuery, no scheduling needed
  ├── Pro: Incremental refresh for append-only base tables
  ├── Con: Limited SQL support (no JSON_VALUE in some contexts)
  ├── Con: Costs compute for refresh
  └── Fallback: If MV limitations hit, use standard VIEW

Option B: Standard VIEW
  ├── Pro: No limitations on SQL, always up-to-date
  ├── Pro: No extra storage cost
  ├── Con: Query-time computation (slower for large tables)
  └── Con: No caching

Option C: Scheduled Query → Table
  ├── Pro: Full SQL support, pre-computed results
  ├── Con: Not real-time (runs on schedule, e.g. every 5 min)
  ├── Con: Need BigQuery Scheduled Queries or Cloud Scheduler
  └── Con: More complex to manage

Recommendation: Try Option A first. If MV limitations are hit,
fall back to Option B (standard VIEW). Option C only if performance
requires pre-computation.
```

### Snowflake

```
Option A: Dynamic Table (preferred)
  ├── Pro: Auto-refreshed with configurable target_lag
  ├── Pro: Full SQL support including PARSE_JSON
  ├── Pro: Snowflake manages refresh scheduling
  ├── Con: Requires a warehouse for refresh compute
  └── Con: Cost scales with refresh frequency × data volume

Option B: Stream + Task
  ├── Pro: Fine-grained control over refresh
  ├── Con: More moving parts (stream, task, target table)
  └── Con: More complex error handling

Option C: Standard VIEW
  ├── Same trade-offs as BigQuery standard view

Recommendation: Option A (Dynamic Table) with target_lag = '1 minute'.
```

### Databricks

```
Option A: Materialized View (Unity Catalog)
  ├── Pro: Auto-refreshed, managed by Databricks
  ├── Pro: Works with Delta tables
  ├── Con: Requires Unity Catalog (most orgs have this now)
  └── Con: Refresh compute uses cluster resources

Option B: Delta Live Table (DLT)
  ├── Pro: Declarative pipeline, auto-refresh
  ├── Con: Requires a DLT pipeline (additional cost)
  └── Con: More complex setup

Option C: Standard VIEW over Delta table
  ├── Same trade-offs as other DWs

Recommendation: Option A (Materialized View) if Unity Catalog available.
Otherwise Option C (VIEW).
```

---

## Decision 4: Auto-Materialization Strategy

### Context

Instead of requiring users to manually select which fields to extract from the
JSON blobs (`attributes`, `properties`), the system auto-discovers fields and
creates typed columns in the materialized views automatically.

### How auto-discovery works

```
Option A: Ingestor-side schema tracking (recommended)
  ├── Ingestor already sees every event
  ├── Maintain running schema per org: { field, type, firstSeen, lastSeen, count }
  ├── Store in MongoDB (discovered_schemas collection) or Kafka compacted topic
  ├── Pro: No DW queries needed, low latency
  ├── Pro: Type information inferred at write time (accurate)
  └── Con: Only sees attributes the ingestor processes

Option B: Periodic sampling from the DW landing table
  ├── Query DW to discover JSON keys (UNNEST/FLATTEN/explode)
  ├── Pro: Sees exactly what's in the DW
  ├── Con: Compute cost per query
  ├── Con: Type inference from JSON is imperfect
  └── Con: Latency (polling interval)

Option C: SDK-side schema declaration
  ├── SDK reports attribute schema to back-end
  ├── Pro: Most accurate type information
  ├── Con: Requires SDK changes
  └── Con: May miss attributes from other SDKs

Recommendation: Option A. The ingestor already processes every event and
has the context_json/properties_json objects before stringifying them.
```

### Type conflict resolution

```
When the same field is seen with different types across events:
  1. string + number  → STRING (widen to string, safe default)
  2. string + boolean → STRING
  3. number + boolean → STRING
  4. null + any type  → the non-null type (nullable)
  5. object/array     → Skip (don't auto-materialize nested objects)

Rationale: STRING is always safe. Users can cast in their own queries.
```

### Column lifecycle

```
Auto-add: YES — new fields trigger view rebuild with new column
Auto-remove: NO — columns only removed via explicit user action
Column budget: Max 200 auto-materialized columns per org (configurable)
  └── Beyond budget: log warning, skip new columns, surface in UI

Why never auto-remove:
  ├── Seasonal data (e.g., holiday campaign attributes) would lose columns
  ├── Schema flapping would cause constant view rebuilds
  ├── Users build dashboards on top of these columns
  └── No data loss risk if we only add
```

### View rebuild strategy

```
When new columns are discovered:
  1. Diff discovered schema vs current materialized columns
  2. If new columns found:
     a. Update MaterializedColumn[] in MongoDB
     b. For each forwarding destination:
        - BigQuery:    CREATE OR REPLACE MATERIALIZED VIEW (or VIEW)
        - Snowflake:   CREATE OR REPLACE DYNAMIC TABLE
        - Databricks:  CREATE OR REPLACE MATERIALIZED VIEW
     c. Views are rebuilt from the full landing table (retroactive)
  3. Throttle: max 1 rebuild per org per 5 minutes (batch new columns)

Why CREATE OR REPLACE is safe:
  ├── Reads from immutable, append-only landing table
  ├── Landing table has full JSON blobs for all time
  ├── New column extracts values from all historical rows retroactively
  └── No data loss, no backfill needed
```

---

## Decision 5: Column Removal Strategy

### Context

When a user explicitly removes a materialized column, what happens?

```
Option A: Remove from materialized view only (recommended)
  ├── Column disappears from the materialized view
  ├── Raw landing table still has the data in the JSON blob
  ├── Data is fully recoverable by re-adding the column
  ├── Pro: Clean, reversible, zero data loss
  └── Implementation: CREATE OR REPLACE view without the column

Option B: Also drop from landing table
  ├── Not applicable — landing table has a fixed schema (JSON blob)
  ├── The column was never in the landing table as a typed column
  └── Only the materialized view had it

Option C: Mark as deprecated, keep in view as NULL
  ├── Column stays in the view but is always NULL for new data
  ├── Old data still has values
  ├── Pro: Doesn't break downstream queries that reference the column
  ├── Con: Confusing — column exists but is empty
  └── Con: Clutters the schema over time
```

**Recommendation:** Option A. The landing table's JSON blobs are never
mutated. Removing a column only affects the view definition. Re-adding
the column later runs a new CREATE OR REPLACE that retroactively
extracts the value from all historical JSON rows. **Zero data loss.**

### Why this is better than ClickHouse

In ClickHouse, removing a column runs `ALTER TABLE DROP COLUMN`, which
physically deletes the data from the MergeTree table. Re-adding requires
a backfill from the source Kafka table. In the forwarded DW architecture,
the landing table (source of truth) is immutable, and views are
recomputable projections — so the remove/re-add cycle is lossless.

---

## Decision 6: Credential Rotation and Security

### How does GrowthBook store customer DW credentials?

```
Same pattern as existing DataSource credentials:
  1. Customer provides credentials via the UI
  2. Back-end encrypts with ENCRYPTION_KEY (AES-256)
  3. Stored as encrypted string in MongoDB
  4. Decrypted at runtime when executing DDL or testing connection

For Terraform/Confluent:
  1. Back-end provides decrypted credentials to Terraform via
     environment variables or Vault
  2. Terraform passes to Confluent connector as config_sensitive
  3. Confluent Cloud encrypts at rest

Rotation:
  1. User updates credentials in GrowthBook UI
  2. Back-end updates encrypted params in MongoDB
  3. Back-end triggers Terraform apply to update connector config
  4. Connector picks up new credentials on next restart
```

---

## Decision 7: Backfill Strategy When Enabling Forwarding

### Context

When a customer enables forwarding for the first time, they likely have
historical data in the managed ClickHouse. Should we backfill?

```
Option A: No backfill — forward-only (recommended for v1)
  ├── Pro: Simple, no special migration logic
  ├── Pro: No risk of duplicates or out-of-order data
  ├── Con: Customer loses historical data in their DW
  └── Mitigation: Document clearly that forwarding starts from enable time

Option B: Backfill from ClickHouse → Customer DW
  ├── Pro: Customer gets full history
  ├── Con: Requires reading from ClickHouse + writing to customer DW
  ├── Con: Need deduplication logic (event_uuid)
  ├── Con: Could be very slow for large histories
  └── Con: ClickHouse read capacity impact

Option C: Backfill from Kafka (topic retention)
  ├── Pro: Uses existing Kafka infrastructure
  ├── Con: Limited by topic retention period (e.g., 7 days)
  ├── Con: Not useful for most backfill scenarios
  └── Con: Connector would need to start from earliest offset

Recommendation: Option A for v1. Consider Option B as a future feature
with a clear "backfill" button in the UI that runs as a background job.
```

---

## Decision 8: Error Handling — Partial Failures

### Context

What if the materialized view DDL succeeds for events but fails for
experiment_views?

```
Strategy: Atomic-ish updates with rollback

1. Record current state of all 3 materialized views
2. Update events materialized view
   └── On failure: rollback to previous state, abort, surface error
3. Update experiment_views materialized view
   └── On failure: rollback experiment_views + events to previous state
4. Update feature_usage materialized view (if applicable)
   └── On failure: rollback all to previous state

Key advantage over ClickHouse:
  - ClickHouse requires DROP VIEW → ALTER TABLE → CREATE VIEW (risky window)
  - BQ/SF/DB use CREATE OR REPLACE (atomic, no downtime window)
  - This makes partial failure less likely and rollback simpler
```

---

## Decision 9: Multi-DW per Org

### Can one org forward to multiple DWs simultaneously?

```
Option A: One forwarding destination per org (simpler)
  ├── Pro: Simple model, one connector, one set of materialized tables
  └── Con: Limits customers who want both BQ and Snowflake

Option B: Multiple forwarding destinations per org (recommended)
  ├── Pro: Flexible, customers can forward to multiple DWs
  ├── Pro: ForwardingDestination model already supports this (has its own id)
  ├── Con: More connectors to manage
  └── Con: Schema changes must update all destinations

Recommendation: Option B. The ForwardingDestination model is per-destination,
not per-org. The updateMaterializedTables call loops over all destinations
for the org. Auto-materialization discovers columns once per org, then
applies to all destinations.
```

---

## Decision 10: Customer-Owned Object Storage

### Context

Events need to reach customer data warehouses. The two broad approaches are:

1. Push directly into the DW (Confluent DW Sink connectors)
2. Push to object storage (Parquet files), then create DW views over external tables

This decision covers the object storage approach. The Confluent BigQuery Sink
approach will be planned separately.

### Decision

**Customer-owned buckets.** Customers set up their own GCS or S3 bucket and
provide GrowthBook write credentials. GrowthBook pushes events as Parquet files.

```
Option A: GrowthBook-owned bucket (rejected)
  ├── Single GCS bucket, partitioned by org, customers get read-only access
  ├── Pro: Single sink destination, simplest Confluent setup
  ├── Con: GrowthBook owns customer data (compliance/control concern)
  ├── Con: Cross-cloud egress for non-GCP customers
  └── Con: Requires per-org IAM grants on a shared bucket

Option B: Customer-owned buckets (chosen)
  ├── Each customer provides their own GCS or S3 bucket
  ├── GrowthBook writes Parquet files to the customer's bucket
  ├── Customer already has read access (they own it)
  ├── Pro: Customer fully owns and controls their data
  ├── Pro: No cross-cloud egress (bucket is on customer's cloud)
  ├── Pro: No shared-bucket isolation concerns (single-tenant per bucket)
  ├── Pro: Customer controls retention, lifecycle, access policies
  ├── Con: Multiple write destinations (one per customer)
  └── Con: Customer must provide and rotate write credentials
```

### Why Customer-Owned Is Better

1. **Data ownership:** Customer data stays in customer infrastructure
2. **No egress cost:** BigQuery customers use GCS, Snowflake/Databricks on AWS use S3
3. **Simpler isolation:** Each bucket is single-tenant, no org-prefix partitioning needed
4. **Compliance:** No GrowthBook-hosted copy of customer event data
5. **Path simplification:** `date=YYYY-MM-DD/hour=HH/` only (no `organization=` prefix)

---

## Decision 11: Push Mechanism (Kafka → Customer Buckets)

### Context

With customer-owned buckets, we need to push events from Kafka to N different
buckets (potentially a mix of GCS and S3). This is different from the single-
connector model where one GCS Sink wrote to one GrowthBook bucket.

See [COST-ANALYSIS-OBJECT-STORAGE.md](COST-ANALYSIS-OBJECT-STORAGE.md) for
detailed pricing.

### Options

```
Option A: Per-customer Confluent GCS/S3 Sink connector
  ├── Each customer gets a dedicated Confluent connector
  ├── Connector pointed at the customer's bucket with their write credentials
  ├── Each connector reads the full shared topic, filters by org (SMT)
  ├── Confluent manages Parquet conversion, flush, delivery, retries
  ├── Pro: Battle-tested, exactly-once delivery, no custom code
  ├── Pro: Parquet output, schema evolution handled by Confluent
  ├── Con: Scales linearly: ~$1,133/mo at 50 orgs
  ├── Con: Each connector reads the full topic (read amplification)
  ├── Con: Credential rotation requires Terraform apply per connector
  └── Con: O(N) connector ops

Option B: Custom consumer service
  ├── GrowthBook-managed service reads from Kafka
  ├── Buffers events per org in memory
  ├── Writes Parquet files to each customer's bucket on flush interval
  ├── Pro: Fixed cost ~$200-400/mo regardless of org count
  ├── Pro: Full control over partitioning, batching, retry logic
  ├── Pro: Supports any storage backend (GCS, S3, Azure, etc.)
  ├── Con: Must build: Parquet serialization, flush scheduling
  ├── Con: Must handle exactly-once delivery, crash recovery
  └── Con: More operational surface (our code vs Confluent managed)

Option C: Hybrid (staging bucket + sync)
  ├── Single GCS Sink to GrowthBook-owned staging bucket (~$19/mo)
  ├── Sync service copies each org's prefix to customer's bucket
  ├── Pro: Cheapest Confluent cost ($19/mo for 1 connector)
  ├── Pro: Staging bucket acts as backup / DLQ
  ├── Pro: Kafka delivery is battle-tested (single connector)
  ├── Con: Extra 5-15 min latency (flush + copy = ~10-30 min total)
  ├── Con: Double storage writes (staging + customer)
  ├── Con: GrowthBook staging bucket has a copy of all org data (brief)
  └── Con: Must still build the sync service
```

### Cost Comparison at 50 Orgs, 1B Events/Month

```
                              Option A         Option B        Option C
                           (Per-customer    (Custom         (Hybrid)
                            connectors)      consumer)
Confluent connectors/mo      ~$1,108          $0              ~$19
Compute (service)/mo            $0          ~$200-400        ~$100-200
Staging storage/mo              $0             $0              ~$15
                              ------         ------           ------
Total GrowthBook/mo          ~$1,133        ~$200-400         ~$235
Cost per org/mo               ~$23           ~$4-8            ~$5
```

Note: Customer pays their own bucket storage (~$4-8/mo for ~200 GB Parquet/yr).

### Decision

**Evaluate Options A and B; decide based on team capacity and timeline.**

- Option A is the fastest path to production (config-only, no custom code)
- Option B is cheaper long-term and more flexible
- Option C adds complexity without clear advantage over A or B

### When to switch from A to B

```
Switch when:
  ├── Connector count exceeds 100 (cost > $2,200/mo)
  ├── Read amplification causes Kafka cluster pressure
  ├── Need to support storage backends beyond GCS/S3
  └── Credential rotation at scale becomes untenable
```

---

## Decision 12: Materialization Strategy with External Tables

### Context

With customer-owned buckets, the DW base table is an external table pointing
at Parquet files in the customer's own GCS or S3 bucket. This determines which
materialization strategies are available.

### Constraints with External Tables

```
BigQuery:
  ├── Materialized views over external tables: NOT supported
  ├── Standard views over external tables: Supported
  └── Recommendation: Standard VIEW (always up-to-date, no extra cost)

Snowflake:
  ├── Dynamic tables over external tables: NOT supported
  ├── Standard views over external tables: Supported
  ├── Alternative: COPY INTO from stage → native table → dynamic table
  └── Recommendation: Standard VIEW for v1; COPY INTO for performance-critical orgs

Databricks:
  ├── Materialized views over external tables: NOT supported
  ├── Standard views over external tables: Supported
  └── Recommendation: Standard VIEW (partition pruning mitigates scan cost)
```

### Why Standard VIEWs Are Acceptable

```
1. Parquet is columnar — queries only read columns referenced in the SELECT
2. Hive partitioning by date + hour — queries with date filters only scan relevant files
3. Single-tenant bucket — no cross-org data to accidentally scan
4. Per-org data is small: ~4 GB Parquet/month
5. No storage cost for views (no data duplication)
6. Views are always current (no refresh lag)
7. CREATE OR REPLACE is atomic (safe schema changes)
```

### Future Optimization: Native Table Promotion

For high-query-frequency orgs, offer an optional "promote to native table":

```
1. Run COPY INTO (Snowflake) or LOAD DATA (BigQuery/Databricks)
   from the external table into a native managed table
2. Create materialized views / dynamic tables over the native table
3. Schedule incremental loads (e.g., hourly COPY INTO with file tracking)
4. This is opt-in, per-org, and only when query performance justifies
   the added storage + compute cost
```

This is a future optimization, not needed for v1.

---

## Decision 13: Schema Evolution Strategy

### Context

Events are written as Parquet files with JSON string columns for `properties`
and `attributes`. Auto-materialized columns extract values from these JSON
blobs via views. How do we handle schema changes safely?

### Parquet File Immutability

```
Key property: Parquet files are NEVER modified after writing.
  ├── New events → new Parquet files (append-only pattern)
  ├── Old files retain their original schema and data forever
  ├── DW external tables union all files, handling missing columns as NULL
  └── This makes all schema evolution operations safe
```

### Adding a Materialized Column

```
1. Ingestor detects new field in properties/attributes JSON for an org
2. Field recorded in MongoDB: { field, type, firstSeen, lastSeen, count }
3. Diff against current materialized columns → new field found
4. For each forwarding destination:
   a. Run CREATE OR REPLACE VIEW adding JSON extraction for new field
   b. BigQuery:   JSON_VALUE(properties, '$.newField')
   c. Snowflake:  PARSE_JSON(properties):newField::VARCHAR
   d. Databricks: get_json_object(properties, '$.newField')
5. New column retroactively reads from ALL historical Parquet files
   (because the JSON blob always contained the field)
6. Zero data loss, no backfill, no reprocessing
```

### Removing a Materialized Column

```
Removal is manual only (never auto-remove). On removal:
1. Run CREATE OR REPLACE VIEW without the removed column
2. Raw Parquet files still contain the JSON blob with that field
3. No physical data is deleted or modified
4. Re-adding the column later:
   a. Run CREATE OR REPLACE VIEW with the column restored
   b. ALL historical values are retroactively available
   c. Zero data loss at any point in the remove/re-add cycle
```

### Avro Schema Evolution (Top-Level Fields)

```
Adding a new Avro field:
  1. Register new schema version (backward-compatible, new field is nullable)
  2. New Parquet files have the new column; old files don't
  3. DW external table: old rows return NULL for new column (automatic)
  4. No impact on existing views; new column available in new rows

Removing an Avro field:
  1. Register new schema version (forward-compatible)
  2. Old Parquet files still have the field (data preserved)
  3. New Parquet files don't have the field
  4. Views referencing the field: old rows have data, new rows return NULL
  5. No data loss in any existing file

Type changes:
  1. Widen to STRING on conflict (e.g., number seen as string → STRING)
  2. Parquet files written with original type remain valid
  3. DW handles coercion (or view casts explicitly)
```

### View Rebuild Strategy

```
When new columns are discovered:
  1. Diff discovered schema vs current materialized columns
  2. If new columns found:
     a. Update MaterializedColumn[] in MongoDB
     b. For each forwarding destination:
        - Run CREATE OR REPLACE VIEW with updated column list
     c. Views are rebuilt from all Parquet files (retroactive)
  3. Throttle: max 1 rebuild per org per 5 minutes (batch new columns)

Why CREATE OR REPLACE is safe:
  ├── Reads from immutable Parquet files via external table
  ├── External table always has all historical data
  ├── New column extracts values from all historical rows retroactively
  └── No data loss, no downtime, no backfill
```
