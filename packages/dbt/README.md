# @growthbook/dbt

Sync dbt semantic layer models and metrics into GrowthBook Fact Tables and Fact Metrics.

```bash
dbt parse
npx @growthbook/dbt sync --datasource ds_abc123 --entities customer=user_id
```

Reads `target/manifest.json`, translates semantic models and metrics into the
[bulk import](https://docs.growthbook.io/api/fact-tables/operation/postBulkImportFacts)
payload, validates it with a dry run, then upserts. Anything GrowthBook cannot
express is listed as skipped with a reason.

Full guide, mapping rules and the support matrix: https://docs.growthbook.io/integrations/dbt
