# Sample Data for Trino Testing

## Dataset Overview

A large sample dataset has been loaded into your Trino instance for testing expensive queries.

- **Table**: `memory.default.large_sample_data`
- **Rows**: 500,000
- **Estimated Size**: ~200 MB
- **Columns**:
  - `id` - Sequential ID (1 to 500,000)
  - `hash1`, `hash2`, `hash3`, `hash4` - MD5 hashes (32 chars each)
  - `num1`, `num2`, `num3` - Random numbers (0 to 1,000,000)
  - `date1` - Random timestamp
  - `category` - Random category (A, B, or C)
  - `padding` - Large text field for data size

## Testing Expensive Queries

### Using the Test Script

From the GrowthBook container (scripts live at the mounted kerberos-trino path):

```bash
docker exec kerberos-trino-growthbook-1 node /app/kerberos-trino/test_expensive_query.js <query_number>
```

Available queries:

1. **Aggregation by category** - Group by and average operations
2. **Sort and filter** - Large result set with ordering
3. **Hash grouping** - String operations and grouping
4. **Complex aggregation** - Multiple group by columns

Examples:

```bash
# Run query 1 (aggregation)
docker exec kerberos-trino-growthbook-1 node /app/kerberos-trino/test_expensive_query.js 1

# Run query 2 (sort and filter)
docker exec kerberos-trino-growthbook-1 node /app/kerberos-trino/test_expensive_query.js 2
```

### Example SQL Queries

```sql
-- Basic aggregation (fast ~2 seconds)
SELECT category, AVG(num1), COUNT(*)
FROM memory.default.large_sample_data
GROUP BY category;

-- Large result set with sort (moderate ~3-5 seconds)
SELECT *
FROM memory.default.large_sample_data
WHERE num1 > 500000
ORDER BY num2 DESC
LIMIT 1000;

-- Complex grouping (slower ~5-10 seconds)
SELECT LEFT(hash1, 4) as hash_prefix, COUNT(*) as cnt
FROM memory.default.large_sample_data
GROUP BY LEFT(hash1, 4)
ORDER BY cnt DESC
LIMIT 20;

-- Multi-level aggregation (moderate ~3-5 seconds)
SELECT
  category,
  FLOOR(num1 / 100000) as bucket,
  COUNT(*) as count,
  AVG(num2) as avg_num2
FROM memory.default.large_sample_data
GROUP BY category, FLOOR(num1 / 100000)
ORDER BY category, bucket;
```

## Reloading Data

If you need to reload the data:

```bash
docker exec kerberos-trino-growthbook-1 node /app/kerberos-trino/load_data_simple.js
```

This will drop and recreate the table with fresh data.

## Direct Access from Host

You can also run queries from your host machine (outside Docker) using the test script:

```bash
cd kerberos-trino
node test_expensive_query.js 1
```

Note: This requires Kerberos to be configured on your host, which may not work. Use the Docker container method above for guaranteed success.
