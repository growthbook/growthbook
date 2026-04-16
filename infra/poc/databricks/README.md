# Databricks External Table POC

Creates external tables over the customer's own GCS or S3 bucket (Parquet
files with hive-style partitioning) using Unity Catalog, then builds views
for events, experiment_views, and feature_usage.

## Prerequisites

1. Customer has a bucket (GCS or S3) with GrowthBook pushing Parquet files to `<BUCKET>/data/date=<YYYY-MM-DD>/hour=<HH>/`
2. Unity Catalog is enabled on the Databricks workspace
3. A storage credential exists for the customer's cloud (GCS service account or AWS IAM role)
4. The credential has read access to the customer's bucket

## Setup

1. Run `01-external-location.sql` to register the bucket location (choose GCS or S3 variant)
2. Run `02-external-table.sql` to create the external table (choose matching variant)
3. Run `03-views.sql` to create the three analytics views
4. Run `04-validation-queries.sql` to validate data and measure performance

## Notes

- No `organization` filter is needed — each customer's bucket only contains their own data
- Standard VIEWs are used (materialized views not supported over external tables)
- Both GCS and S3 variants are provided; use the one matching the customer's cloud

## Expected Query Performance

With Parquet + hive partition pruning by date:

- Per-org data volume: ~4 GB Parquet/month
- Databricks auto-prunes partitions when filtering on `date`
- Use a small cluster (2-4 workers) for POC queries
