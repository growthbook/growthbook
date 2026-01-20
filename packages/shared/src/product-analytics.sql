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
      AND (
        event_type = 'purchase'
      )
  ),

  -- Dynamically calculate top dimension values
  -- This takes into account the date/metric filters on the fact table
  -- TODO: what if there are multiple fact tables?
  -- Each dimension gets a separate CTE
  _dimension0_top AS (
    SELECT browser
    FROM _factTable0
    GROUP BY browser
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ),

  -- Calculate dimension and event values for each metric
  _factTable0_event AS (
    -- Event-level values
    SELECT
      -- Date grouping
      date_trunc(timestamp, day) as day,
      -- Dimension grouping
      CASE WHEN browser IN (SELECT browser FROM _dimension0_top)
          THEN browser
        ELSE 'other'
      END AS dimension0,
      -- Select units for any unit count metrics
      user_id as unit0,
      -- Count metric (purchases)
      -- Each matching row gets a value of 1
      CASE WHEN (event_type = 'purchase') THEN 1 ELSE NULL END as m0_value,
      -- Sum metric (revenue)
      -- Each matching row gets the amount value
      CASE WHEN (event_type = 'purchase') THEN amount ELSE NULL END as m1_value,
      -- Unit count metric (users who purchased)
      -- Each matching row gets a value of 1
      CASE WHEN (event_type = 'purchase') THEN 1 ELSE NULL END as m2_value,
      -- Distinct count metric (unique countries who purchased)
      -- Each matching row gets the country value
      CASE WHEN (event_type = 'purchase') THEN country ELSE NULL END as m3_value,
      -- Ratio (average order value)
      -- Each matching row gets the amount value for numerator
      CASE WHEN (event_type = 'purchase') THEN amount ELSE NULL END as m4_value,
      -- Each matching row gets a value of 1 for denominator
      CASE WHEN (event_type = 'purchase') THEN 1 ELSE NULL END as m4_denominator
      -- Unit count with threshold
      -- Each matching row gets the amount value
      CASE WHEN (event_type = 'purchase') THEN amount ELSE NULL END as m5_value,
      -- Quantile metric (P90 revenue)
      -- Each matching row gets the amount value
      CASE WHEN (event_type = 'purchase') THEN amount ELSE NULL END as m6_value
    FROM _factTable0
  ),

  -- Aggregate unit count metrics by unit
  -- Each unit gets a separate CTE
  _factTable0_unit0 AS (
    SELECT
      day,
      dimension0,
      -- Unit count metric
      MAX(m2_value) as m2_value,
      -- Unit count with threshold
      CASE WHEN SUM(m5_value) > 100 THEN 1 ELSE NULL END as m5_value
    FROM _factTable0
    GROUP BY unit0, day, dimension0
  ),

  -- Aggregate unit count metrics by day
  _factTable0_unit0_daily AS (
    SELECT
      day,
      dimension0,
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
    GROUP BY day, dimension0
  ),

  -- Aggregate event level metrics by day
  _factTable0_event_daily AS (
    SELECT
      day,
      dimension0,
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
      -- Quantile metric
      PERCENTILE_APPROX(m6_value, 0.9) as m6_value
    FROM _factTable0
    GROUP BY day, dimension0
  ),

  -- Combine all daily CTEs
  -- Each metric value will appear in only 1 daily CTE (with nulls in the rest)
  _combined AS (
    SELECT * FROM _factTable0_unit0_daily
    UNION ALL
    SELECT * FROM _factTable0_event_daily  
  )

-- Aggregate to return a single row per day/dimension
SELECT
  day,
  dimension0,
  SUM(m0_value) as m0_value,
  SUM(m1_value) as m1_value,
  SUM(m2_value) as m2_value,
  SUM(m3_value) as m3_value,
  SUM(m4_value) as m4_value,
  SUM(m4_denominator) as m4_denominator,
  SUM(m5_value) as m5_value,
  MAX(m6_value) as m6_value
FROM _combined
GROUP BY day, dimension0
-- Sanity check limit
LIMIT 1000;