/**
 * Generates hardcoded JSON files for mock explore data:
 * - One file per fact table: raw row-level data (one year of days, 100–500 rows/day).
 * - One file per fact metric: pre-aggregated daily rows (ExploreDataPoint shape).
 *
 * Run from front-end package: pnpm run generate-mock-data-json
 */

import fs from "node:fs";
import path from "node:path";
import type {
  FactTableInterface,
  FactMetricInterface,
  ColumnInterface,
} from "shared/types/fact-table";
import type { ExploreDataPoint } from "shared/enterprise";
import {
  createDummyFactTables,
  createDummyFactMetrics,
} from "../services/mockData";

const scriptPath = process.argv[1];
const scriptDir = path.dirname(
  path.resolve(scriptPath ? path.join(process.cwd(), scriptPath) : "."),
);
const ROOT = path.resolve(scriptDir, "..");
const FACT_TABLES_DIR = path.join(ROOT, "services", "mockData", "factTables");
const METRICS_DIR = path.join(ROOT, "services", "mockData", "metrics");

const SEED = 42;
const ROWS_PER_DAY_MIN = 100;
const ROWS_PER_DAY_MAX = 500;

// Use a full year of data ending today so lookbacks (7d, 30d, 90d) work
function getDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) for reproducible output
// ---------------------------------------------------------------------------
function createSeededRng(seed: number) {
  let state = seed;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0; // mulberry32
    const t = Math.imul(state ^ (state >>> 15), 1 | state);
    return ((t + (t ^ (t >>> 7))) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Value pools for string columns (aligned with mockData generateGroupNames)
// ---------------------------------------------------------------------------
const VALUE_POOLS: Record<string, string[]> = {
  event_name: [
    "Page View",
    "Purchase",
    "Sign Up",
    "Login",
    "Add to Cart",
    "Checkout Started",
    "Video Played",
    "Download",
  ],
  device_type: ["Mobile", "Desktop", "Tablet", "Smart TV", "Wearable"],
  browser: [
    "Chrome",
    "Firefox",
    "Safari",
    "Edge",
    "Opera",
    "Brave",
    "Samsung Internet",
  ],
  os: ["Windows", "macOS", "Linux", "iOS", "Android", "Chrome OS"],
  country: [
    "United States",
    "United Kingdom",
    "Canada",
    "Germany",
    "France",
    "Australia",
    "Japan",
    "Brazil",
    "India",
    "Spain",
    "Italy",
    "Netherlands",
  ],
  payment_method: [
    "Credit Card",
    "Debit Card",
    "PayPal",
    "Apple Pay",
    "Google Pay",
    "Bank Transfer",
    "Cryptocurrency",
    "Cash on Delivery",
  ],
  category: [
    "Electronics",
    "Clothing",
    "Food & Beverage",
    "Books",
    "Toys",
    "Home & Garden",
    "Sports",
    "Beauty",
    "Automotive",
    "Health",
  ],
  utm_source: [
    "Google",
    "Facebook",
    "Twitter",
    "LinkedIn",
    "Email",
    "Direct",
    "Organic",
  ],
  utm_medium: [
    "cpc",
    "social",
    "email",
    "organic",
    "referral",
    "display",
    "affiliate",
  ],
  utm_campaign: [
    "Summer Sale",
    "Black Friday",
    "New Product Launch",
    "Holiday Special",
    "Referral Program",
    "Newsletter Signup",
    "Brand Awareness",
  ],
  referrer: [
    "google.com",
    "facebook.com",
    "twitter.com",
    "linkedin.com",
    "direct",
    "newsletter",
    "partner-site.com",
  ],
  currency: ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"],
  shipping_country: [
    "United States",
    "United Kingdom",
    "Canada",
    "Germany",
    "France",
    "Australia",
    "Japan",
  ],
};

function getPoolForColumn(column: string): string[] {
  const pool = VALUE_POOLS[column];
  if (pool) return pool;
  // Generic IDs: user_id, anonymous_id, order_id, etc.
  if (
    column.includes("_id") ||
    column === "user_id" ||
    column === "anonymous_id" ||
    column === "customer_id" ||
    column === "order_id" ||
    column === "product_id" ||
    column === "session_id"
  ) {
    return Array.from({ length: 50 }, (_, i) => `id-${column}-${i + 1}`);
  }
  if (column === "product_name") {
    return [
      "Product Alpha",
      "Product Beta",
      "Product Gamma",
      "Product Delta",
      "Product Epsilon",
      "Product Zeta",
      "Product Eta",
    ];
  }
  return Array.from({ length: 8 }, (_, i) => `${column}-${i + 1}`);
}

// ---------------------------------------------------------------------------
// Get date column name from fact table
// ---------------------------------------------------------------------------
function getDateColumn(columns: ColumnInterface[]): string {
  const dateCol = columns.find((c) => c.datatype === "date");
  return dateCol ? dateCol.column : "timestamp";
}

// ---------------------------------------------------------------------------
// Generate one fact table row for a given day and row index
// ---------------------------------------------------------------------------
function generateFactTableRow(
  table: FactTableInterface,
  dateStr: string,
  rowIndex: number,
  rng: () => number,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const dateCol = getDateColumn(table.columns);
  const date = new Date(dateStr);
  // Spread timestamps within the day (optional: add seconds)
  const secondsOffset = Math.floor(rng() * 86400);
  date.setSeconds(secondsOffset % 60);
  date.setMinutes(Math.floor(secondsOffset / 60) % 60);
  date.setHours(Math.floor(secondsOffset / 3600));

  for (const col of table.columns) {
    if (col.deleted) continue;
    const key = col.column;
    switch (col.datatype) {
      case "date":
        row[key] = date.toISOString().split(".")[0] + "Z";
        break;
      case "string":
        const pool = getPoolForColumn(key);
        row[key] = pool[Math.floor(rng() * pool.length)];
        break;
      case "number":
        if (
          key === "amount" ||
          key === "quantity" ||
          key === "session_duration_seconds" ||
          key === "page_views" ||
          key === "events_count"
        ) {
          const base =
            key === "amount"
              ? 10 + rng() * 200
              : key === "quantity"
                ? 1 + Math.floor(rng() * 10)
                : key === "session_duration_seconds"
                  ? 60 + rng() * 1800
                  : 1 + Math.floor(rng() * 50);
          row[key] = Math.round(base * 100) / 100;
        } else {
          row[key] = Math.floor(10 + rng() * 1000);
        }
        break;
      case "json":
        row[key] = { source: "mock", rowIndex };
        break;
      default:
        row[key] = null;
    }
  }
  return row;
}

// ---------------------------------------------------------------------------
// Generate all fact table JSON files
// ---------------------------------------------------------------------------
function generateFactTableFiles(): void {
  const factTables = createDummyFactTables();
  const { start: YEAR_START, end: YEAR_END } = getDateRange();
  const startDate = new Date(YEAR_START);
  const endDate = new Date(YEAR_END);
  const days: string[] = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().split("T")[0]);
  }

  for (const table of factTables) {
    const tableSeed =
      SEED + table.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const allRows: Record<string, unknown>[] = [];

    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
      const dateStr = days[dayIndex];
      const daySeed = tableSeed + dayIndex * 1000;
      const dayRng = createSeededRng(daySeed);
      const rowsThisDay =
        ROWS_PER_DAY_MIN +
        Math.floor(dayRng() * (ROWS_PER_DAY_MAX - ROWS_PER_DAY_MIN + 1));

      for (let r = 0; r < rowsThisDay; r++) {
        const rowRng = createSeededRng(daySeed + r * 2);
        allRows.push(generateFactTableRow(table, dateStr, r, rowRng));
      }
    }

    const outPath = path.join(FACT_TABLES_DIR, `${table.id}.json`);
    fs.writeFileSync(outPath, JSON.stringify(allRows, null, 2), "utf-8");
    console.log(`Wrote ${outPath} (${allRows.length} rows)`);
  }
}

// ---------------------------------------------------------------------------
// Generate one metric daily row (ExploreDataPoint shape)
// ---------------------------------------------------------------------------
function generateMetricRow(
  metric: FactMetricInterface,
  dateStr: string,
  rng: () => number,
): ExploreDataPoint {
  const baseValue = 100 + rng() * 400;
  const units = Math.floor(baseValue * (0.8 + rng() * 0.4));
  const mean = baseValue / Math.max(units, 1);
  const stddev = mean * 0.1;
  const numerator = baseValue;

  const point: ExploreDataPoint = {
    date: dateStr,
    units,
    mean,
    stddev,
    numerator,
  };

  if (metric.metricType === "ratio" && metric.denominator) {
    const denomBase = 200 + rng() * 800;
    point.denominator = denomBase;
    point.mean = denomBase > 0 ? numerator / denomBase : 0;
  }

  return point;
}

// ---------------------------------------------------------------------------
// Generate all metric JSON files
// ---------------------------------------------------------------------------
function generateMetricFiles(): void {
  const metrics = createDummyFactMetrics();
  const { start: YEAR_START, end: YEAR_END } = getDateRange();
  const startDate = new Date(YEAR_START);
  const endDate = new Date(YEAR_END);
  const days: string[] = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().split("T")[0]);
  }

  for (const metric of metrics) {
    const metricSeed =
      SEED +
      10000 +
      metric.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const rows: ExploreDataPoint[] = [];

    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
      const dateStr = days[dayIndex];
      const dayRng = createSeededRng(metricSeed + dayIndex);
      rows.push(generateMetricRow(metric, dateStr, dayRng));
    }

    const outPath = path.join(METRICS_DIR, `${metric.id}.json`);
    fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), "utf-8");
    console.log(`Wrote ${outPath} (${rows.length} days)`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  const { start, end } = getDateRange();
  console.log(`Date range: ${start} to ${end} (1 year ending today)`);
  fs.mkdirSync(FACT_TABLES_DIR, { recursive: true });
  fs.mkdirSync(METRICS_DIR, { recursive: true });
  console.log("Generating fact table JSON files...");
  generateFactTableFiles();
  console.log("Generating metric JSON files...");
  generateMetricFiles();
  console.log("Done.");
}

main();
