WITH 
  -- Fact table filtered by date and rough metric filters for performance
  -- If metrics are from different fact tables, each one gets a separate CTE
  _factTable0 AS (
    SELECT * FROM (
      -- Raw fact table SQL
      SELECT
        timestamp,
        user_id,
        event_type
      FROM events
    ) t
    WHERE 
      -- Date range filter
      timestamp >= '2026-01-01' AND timestamp <= '2026-01-31'
      -- Filter on all distinct metric conditions ORed together
      -- This can help engines take advantage of partitions
      -- This also makes top dimension values more accurate
      AND (
        event_type = 'purchase'
      )
  ),

  -- Dynamic dimensions where we don't know the top values ahead of time
  -- This takes into account the date/metric filters on the fact table
  _dimension0_top AS (
    SELECT browser
    FROM _factTable0
    GROUP BY browser
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ),

  -- Calculate dimension and metric values for each row
  _factTable0_rows AS (
    SELECT
      -- Date dimension
      date_trunc(timestamp, day) as dimension0,
      -- Dynamic dimension
      CASE 
        WHEN browser IN (SELECT browser FROM _dimension0_top) THEN browser
        ELSE 'other'
      END AS dimension1,
      -- Static dimension
      CASE 
        WHEN browser IN ('chrome', 'safari', 'firefox') THEN browser 
        ELSE 'other' 
      END AS dimension2,
      -- Slice dimension
      CASE
        WHEN (browser = 'chrome') THEN 'Chrome'
        WHEN (browser = 'safari') THEN 'Safari'
        WHEN (browser = 'firefox') THEN 'Firefox'
        ELSE 'other'
      END AS dimension3,
      -- Select units for any unit count metrics
      user_id as unit0,
      -- Count metric (purchases)
      CASE WHEN (event_type = 'purchase') THEN 1 ELSE NULL END as m0_value,
      -- Sum/Min/Max metric (revenue)
      CASE WHEN (event_type = 'purchase') THEN amount ELSE NULL END as m1_value,
      -- Unit count metric (users who purchased)
      CASE WHEN (event_type = 'purchase') THEN 1 ELSE NULL END as m2_value,
      -- Distinct count metric (unique countries who purchased)
      CASE WHEN (event_type = 'purchase') THEN country ELSE NULL END as m3_value,
      -- Ratio (average order value)
      CASE WHEN (event_type = 'purchase') THEN amount ELSE NULL END as m4_value,
      CASE WHEN (event_type = 'purchase') THEN 1 ELSE NULL END as m4_denominator
      -- Unit count with threshold (amount > 100)
      CASE WHEN (event_type = 'purchase') THEN amount ELSE NULL END as m5_value,
      -- Quantile metric (P90 revenue)
      CASE WHEN (event_type = 'purchase') THEN amount ELSE NULL END as m6_value
    FROM _factTable0
  ),

  -- Aggregate unit count metrics by unit
  -- Each unit gets separate CTEs
  _factTable0_unit0 AS (
    SELECT
      unit0,
      dimension0,
      dimension1,
      dimension2,
      dimension3,
      -- Unit count metric
      MAX(m2_value) as m2_value,
      -- Unit count with threshold
      CASE WHEN SUM(m5_value) > 100 THEN 1 ELSE NULL END as m5_value
    FROM _factTable0_rows
    GROUP BY unit0, dimension0, dimension1, dimension2, dimension3
  ),

  -- Aggregate unit count metrics by dimension
  _factTable0_unit0_rollup AS (
    SELECT
      dimension0,
      dimension1,
      dimension2,
      dimension3,
      -- Count metric (skip)
      NULL as m0_value,
      -- Sum metric (skip)
      NULL as m1_value,
      -- Unit count metric
      SUM(m2_value) as m2_value,
      -- Distinct count metric (skip)
      NULL as m3_value,
      -- Ratio (skip)
      NULL as m4_value,
      NULL as m4_denominator,
      -- Unit count with threshold
      SUM(m5_value) as m5_value,
      -- Quantile metric (skip)
      NULL as m6_value
    FROM _factTable0_unit0
    GROUP BY dimension0, dimension1, dimension2, dimension3
  ),

  -- Aggregate event level metrics by dimension
  _factTable0_event_rollup AS (
    SELECT
      dimension0,
      dimension1,
      dimension2,
      dimension3,
      -- Count metric
      SUM(m0_value) as m0_value,
      -- Sum metric
      SUM(m1_value) as m1_value,
      -- Unit count metric (skip)
      NULL as m2_value,
      -- Distinct count metric
      COUNT(DISTINCT m3_value) as m3_value,
      -- Ratio
      SUM(m4_value) as m4_value,
      SUM(m4_denominator) as m4_denominator,
      -- Unit count with threshold (skip)
      NULL as m5_value,
      -- Quantile metric (event level)
      PERCENTILE_APPROX(m6_value, 0.9) as m6_value
    FROM _factTable0_rows
    GROUP BY dimension0, dimension1, dimension2, dimension3
  ),

  -- Combine all rollup CTEs
  -- Each metric value will appear in only 1 rollup CTE (with nulls in the rest)
  _combined_rollup AS (
    SELECT * FROM _factTable0_unit0_rollup
    UNION ALL
    SELECT * FROM _factTable0_event_rollup  
  )

-- Aggregate to return a single row per dimension
SELECT
  dimension0,
  dimension1,
  dimension2,
  dimension3,
  SUM(m0_value) as m0_value,
  SUM(m1_value) as m1_value,
  SUM(m2_value) as m2_value,
  SUM(m3_value) as m3_value,
  SUM(m4_value) as m4_value,
  SUM(m4_denominator) as m4_denominator,
  SUM(m5_value) as m5_value,
  MAX(m6_value) as m6_value
FROM _combined_rollup
GROUP BY dimension0, dimension1, dimension2, dimension3
-- Sanity check limit
LIMIT 1000;