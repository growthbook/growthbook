# BigQuery External Table POC

Creates an external table over the customer's own GCS bucket (Parquet files
with hive-style partitioning), then builds views for events, experiment_views,
and feature_usage.

## Prerequisites

1. Customer has a GCS bucket with GrowthBook pushing Parquet files to `gs://<BUCKET>/data/date=<YYYY-MM-DD>/hour=<HH>/`
2. BigQuery dataset exists in the customer's GCP project
3. BigQuery has read access to the customer's GCS bucket (automatic if same project, or grant `storage.objectViewer`)

## Setup

1. Replace `CUSTOMER_BUCKET`, `PROJECT_ID`, and `DATASET` placeholders in the SQL files
2. Run `01-external-table.sql` to create the external table
3. Run `02-materialized-views.sql` to create the three views
4. Run `03-validation-queries.sql` to validate data and measure performance

## Notes

- No `organization` filter is needed — each customer's bucket only contains their own data
- Standard VIEWs are used (BigQuery does not support materialized views over external tables)
- Partition pruning on `date` and `hour` keeps query costs low

## Expected Query Performance

With Parquet + hive partition pruning:

- Per-org data volume: ~4 GB Parquet/month
- Full month scan: ~$0.02 at $6.25/TiB on-demand pricing
- BigQuery auto-prunes partitions, only reading the date range's files
