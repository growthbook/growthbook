# Cost Analysis: Push Mechanisms for Customer-Owned Object Storage

Pricing data sourced from Confluent Cloud pricing pages (April 2025).

## Architecture

Customers own their GCS/S3 buckets. GrowthBook pushes enriched events as
Parquet files to each customer's bucket. Customer DWs query via external tables
with views managed by GrowthBook.

## Confluent Pricing Reference (Exact)

### GCS Sink Connector (Fully Managed)

| Metric        | Rate                         |
| ------------- | ---------------------------- |
| Task          | $0.017 - $0.0347 /task/hour  |
| Data Transfer | $0.025 /GB (pre-compression) |

### S3 Sink Connector (Fully Managed)

| Metric        | Rate                         |
| ------------- | ---------------------------- |
| Task          | $0.022 - $0.044 /task/hour   |
| Data Transfer | $0.025 /GB (pre-compression) |

### DW Sink Connectors (for baseline comparison)

| Connector                  | Task Rate                 | Data Transfer |
| -------------------------- | ------------------------- | ------------- |
| BigQuery V2 Sink           | $0.050 - $0.10 /task/hr   | $0.025/GB     |
| Snowflake Sink             | $0.052 - $0.1041 /task/hr | $0.025/GB     |
| Databricks Delta Lake Sink | $0.150 - $0.30 /task/hr   | $0.025/GB     |

---

## Scenario: 50 Forwarding Orgs, 1B Events/Month (~385 eps)

Assumptions:

- Average event size: 1 KB (raw)
- Total raw throughput: ~1 TB/month
- Parquet compression ratio: ~5x (1 TB raw → ~200 GB Parquet)
- Even distribution across orgs: ~20 GB raw / ~4 GB Parquet per org per month
- Connector pricing uses midpoint of published range
- Customer mix: 30 GCS (BigQuery), 20 S3 (Snowflake/Databricks on AWS)

---

### Option A: Per-Customer Confluent GCS/S3 Sink Connectors

Each customer gets a dedicated connector pointed at their bucket.
Each connector reads the full shared topic and filters by org (SMT).

```
GCS Sink connectors (30 customers):
  30 tasks × $0.026/hr × 720 hrs = $561/mo

S3 Sink connectors (20 customers):
  20 tasks × $0.033/hr × 720 hrs = $475/mo

Data transfer (post-SMT-filter, each org ~20 GB):
  50 orgs × 20 GB × $0.025/GB = $25/mo

Total GrowthBook/mo: ~$1,061
```

Scaling note: each connector reads the FULL topic (385 eps) but discards
events for other orgs via SMT. At 50 orgs, total read amplification is
50 × 385 = 19,250 eps. This is within a standard CKU but wasteful.

### Option B: Custom Consumer Service

A GrowthBook-managed service reads from Kafka, buffers per org, writes
Parquet files to each customer's bucket.

```
Compute (Kubernetes):
  2-3 pods × ~$0.05-0.08/hr × 720 hrs = $72-173/mo
  With overhead (monitoring, logging): ~$200-400/mo

Confluent cost: $0 (no connectors — direct Kafka consumer)

Data transfer: $0 (customer pays egress from their cloud)

Total GrowthBook/mo: ~$200-400
```

Cost is fixed regardless of org count. At 200 orgs, still ~$200-400/mo.

### Option C: Hybrid (Staging Bucket + Sync)

Single GCS Sink to GrowthBook-owned staging bucket, then a sync service
copies each org's data to their bucket.

```
GCS Sink connector (1 connector, staging bucket):
  1 task × $0.026/hr × 720 hrs = $18.72/mo

Data transfer (Confluent → staging):
  1 TB × $0.025/GB = $25/mo

Staging bucket storage (cumulative, Standard class):
  Month 1:   200 GB × $0.02 = $4/mo
  Month 12:  2.4 TB × $0.02 = $48/mo
  With lifecycle (Nearline after 90d): ~$30/mo at month 12

Sync service compute:
  ~$100-200/mo (copies files from staging to N customer buckets)

Total GrowthBook/mo (month 1):  ~$250
Total GrowthBook/mo (month 12): ~$275
```

### Baseline: DW Sink per Org (for comparison)

```
Connector costs (50 orgs, mix of BQ/SF/DB):
  BigQuery:    25 × $0.075/hr × 720 = $1,350/mo
  Snowflake:   15 × $0.078/hr × 720 =   $842/mo
  Databricks:  10 × $0.225/hr × 720 = $1,620/mo
                                        $3,812/mo

Data transfer: $25/mo

Total GrowthBook/mo: ~$3,837
```

---

## Summary Comparison

|                         | DW Sink (baseline) | Option A (per-customer) | Option B (custom consumer) | Option C (hybrid) |
| ----------------------- | ------------------ | ----------------------- | -------------------------- | ----------------- |
| Confluent cost/mo       | $3,812             | ~$1,036                 | $0                         | ~$44              |
| Compute cost/mo         | $0                 | $0                      | ~$200-400                  | ~$100-200         |
| Staging storage/mo      | N/A                | N/A                     | N/A                        | ~$15-30           |
| Data transfer/mo        | $25                | $25                     | $0                         | $25               |
| **Total GrowthBook/mo** | **~$3,837**        | **~$1,061**             | **~$200-400**              | **~$250-275**     |
| **Savings vs DW Sink**  | baseline           | **72%**                 | **90-95%**                 | **93%**           |
| Cost per org/mo         | ~$77               | ~$21                    | ~$4-8                      | ~$5               |
| Scales with org count?  | Yes (linear)       | Yes (linear)            | No (fixed)                 | No (fixed)        |
| Custom code needed?     | No                 | No                      | Yes (high)                 | Yes (medium)      |
| Ops complexity          | O(N) connectors    | O(N) connectors         | O(1) service               | O(1) + staging    |

---

## Customer-Side Costs

With customer-owned buckets, the customer pays their own storage and DW query costs.

### Storage Cost per Org

| Cloud        | Storage Class | Monthly Cost (~4 GB Parquet/mo) | Annual Cumulative            |
| ------------ | ------------- | ------------------------------- | ---------------------------- |
| GCS Standard | $0.020/GB/mo  | ~$0.08/mo (month 1)             | ~$0.96/mo (month 12, ~48 GB) |
| S3 Standard  | $0.023/GB/mo  | ~$0.09/mo (month 1)             | ~$1.10/mo (month 12, ~48 GB) |

Customer storage costs are negligible (<$2/mo/org even after a year of data).

### DW Query Cost per Org

| DW         | Cost Model                         | Estimated Monthly                              |
| ---------- | ---------------------------------- | ---------------------------------------------- |
| BigQuery   | $6.25/TiB scanned; 1 TiB free tier | ~$2/mo at 100 queries (often within free tier) |
| Snowflake  | Warehouse compute                  | ~$5-30/mo depending on query frequency         |
| Databricks | Cluster compute (DBU)              | ~$5-30/mo depending on query frequency         |

---

## Scaling Projections

### At 200 Orgs, 4B Events/Month

|                 | Option A | Option B  | Option C  |
| --------------- | -------- | --------- | --------- |
| Confluent/mo    | ~$4,244  | $0        | ~$44      |
| Compute/mo      | $0       | ~$400-600 | ~$200-400 |
| Total/mo        | ~$4,269  | ~$400-600 | ~$345-475 |
| Cost per org/mo | ~$21     | ~$2-3     | ~$2       |

Option A scales linearly and becomes expensive at 200+ orgs.
Options B and C remain nearly flat.

---

## Recommendation

**Option A (per-customer connectors) for quick launch; migrate to Option B
(custom consumer) when org count or cost justifies it.**

- Option A is zero custom code — fastest path to production
- Option B is the long-term winner on cost and flexibility
- Option C's staging bucket adds complexity without clear advantage over B
- The DW Sink baseline is 3-10x more expensive than any object storage option

### Migration trigger from A → B

```
Switch when:
  ├── Connector count exceeds 100 (~$2,100/mo in connector fees)
  ├── Read amplification causes Kafka cluster pressure
  ├── Need storage backends beyond GCS/S3 (e.g., Azure Blob)
  └── Credential rotation at scale becomes untenable
```
