# Snowflake External Table POC

Creates external tables over the customer's own GCS or S3 bucket (Parquet
files with hive-style partitioning), then builds views for events,
experiment_views, and feature_usage.

## Prerequisites

1. Customer has a bucket (GCS or S3) with GrowthBook pushing Parquet files to `<BUCKET>/data/date=<YYYY-MM-DD>/hour=<HH>/`
2. Snowflake storage integration configured for the customer's cloud (GCS or S3)
3. For GCS: Snowflake's GCS service account has `storage.objectViewer` on the bucket
4. For S3: Customer's IAM role trust policy grants access to Snowflake's IAM user

## Setup

1. Run `01-storage-integration.sql` as ACCOUNTADMIN (choose GCS or S3 variant)
2. Run `02-external-table.sql` to create the external stage and table (choose matching variant)
3. Run `03-views.sql` to create the three analytics views
4. Run `04-validation-queries.sql` to validate data and measure performance

## Notes

- No `organization` filter is needed — each customer's bucket only contains their own data
- Standard VIEWs are used (Dynamic Tables not supported over external tables)
- Both GCS and S3 variants are provided; use the one matching the customer's cloud

## Expected Query Performance

With Parquet + partition pruning by date:

- Per-org data volume: ~4 GB Parquet/month
- Snowflake auto-prunes external table partitions
- Recommended: X-Small warehouse for POC queries
