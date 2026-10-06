/**
 * TEMPORARY: seeds Postgres with synthetic interleaving telemetry, then runs
 * interleaving analyses through the REST API, including the dev-only routes in
 * src/api/interleaving/interleaving-dev.router.ts. Remove both before landing.
 *
 * Setup:
 *   1. docker run -d --name gb-interleaving-pg -e POSTGRES_PASSWORD=postgres \
 *        -p 5432:5432 postgres:16
 *   2. In GrowthBook, add a Postgres Data Source pointing at that database with
 *      a `user_id` identifier type, and note its id.
 *   3. From packages/back-end:
 *        GB_API_KEY=secret_... GB_DATASOURCE_ID=ds_... \
 *          pnpm exec tsx src/scripts/seed-interleaving-demo.ts
 *
 * Optional env: GB_API_HOST (http://localhost:3100), PG_URL
 * (postgres://postgres:postgres@localhost:5432/postgres), USERS (2000).
 *
 * The data is built so "buyers-picks" (ranks by item quality) beats
 * "price-low" (ranks by price): expect positive uplift for the treatment.
 */
import { randomUUID } from "crypto";
import { Client } from "pg";

const API_HOST = (process.env.GB_API_HOST || "http://localhost:3100").replace(
  /\/$/,
  "",
);
const API_KEY = process.env.GB_API_KEY;
const DATASOURCE_ID = process.env.GB_DATASOURCE_ID;
const PG_URL =
  process.env.PG_URL || "postgres://postgres:postgres@localhost:5432/postgres";
const USERS = parseInt(process.env.USERS || "2000", 10);

const TABLE = "gb_interleaving_demo_events";
const TRACKING_KEY = "featured-products-ranker";
// [control, treatment]
const VARIATIONS: [string, string] = ["price-low", "buyers-picks"];
const LIST_LENGTH = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

const EXPOSURE_QUERY = `SELECT
  user_id,
  received_at AS timestamp,
  properties->>'experimentId' AS experiment_id,
  properties->>'interleaveId' AS interleave_id,
  properties->'items' AS items
FROM ${TABLE}
WHERE event_name = 'Interleave Exposure'`;

const FACT_TABLE_SQL = `SELECT
  user_id,
  received_at AS timestamp,
  properties->>'item_id' AS item_id,
  properties->>'interleave_id' AS interleave_id,
  (properties->>'value')::float AS value
FROM ${TABLE}
WHERE event_name = 'Add to Cart'`;

// Seeded so reruns load identical data
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);

type Product = { id: string; quality: number; price: number };
type Item = {
  itemId: string;
  variation: string;
  competitive: boolean;
  position: number;
};
type EventRow = {
  userId: string;
  eventName: string;
  receivedAt: Date;
  properties: Record<string, unknown>;
};

const catalog: Product[] = Array.from({ length: 60 }, (_, i) => ({
  id: `sku_${i}`,
  quality: 0.02 + rand() * 0.23,
  price: Math.round((2 + rand() * 38) * 100) / 100,
}));

// Per-impression noise so lists vary between impressions
function rank(score: (p: Product) => number): string[] {
  return catalog
    .map((p) => ({ id: p.id, s: score(p) + rand() * 0.05 }))
    .sort((a, b) => b.s - a.s)
    .map((p) => p.id);
}

// Team-draft interleaving. An item is non-competitive when the other team's
// top unpicked item is the same one, i.e. both rankers would have shown it.
function teamDraft(lists: [string[], string[]]): Item[] {
  const picked = new Set<string>();
  const items: Item[] = [];
  const top = (list: string[]) => list.find((id) => !picked.has(id)) ?? "";
  while (items.length < LIST_LENGTH) {
    const order = rand() < 0.5 ? [0, 1] : [1, 0];
    for (const team of order) {
      if (items.length >= LIST_LENGTH) break;
      const itemId = top(lists[team]);
      items.push({
        itemId,
        variation: VARIATIONS[team],
        competitive: top(lists[1 - team]) !== itemId,
        position: items.length,
      });
      picked.add(itemId);
    }
  }
  return items;
}

function generateEvents(): EventRow[] {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const maxPrice = Math.max(...catalog.map((p) => p.price));
  const now = Date.now();
  const rows: EventRow[] = [];

  for (let u = 0; u < USERS; u++) {
    const userId = `user_${u}`;
    const impressions = 1 + Math.floor(rand() * 5);
    for (let i = 0; i < impressions; i++) {
      const exposedAt = now - (1 + rand() * 13) * DAY_MS;
      const interleaveId = randomUUID();
      const items = teamDraft([
        rank((p) => 1 - p.price / maxPrice),
        rank((p) => p.quality * 4),
      ]);
      rows.push({
        userId,
        eventName: "Interleave Exposure",
        receivedAt: new Date(exposedAt),
        properties: { experimentId: TRACKING_KEY, interleaveId, items },
      });

      for (const item of items) {
        const product = byId.get(item.itemId);
        if (!product) continue;
        const pClick = product.quality / (1 + 0.4 * item.position);
        if (rand() >= pClick) continue;
        // Most carts happen in the impression (joinable via interleave_id);
        // the rest come later from elsewhere, which only ownership credits
        const inSession = rand() < 0.7;
        rows.push({
          userId,
          eventName: "Add to Cart",
          receivedAt: new Date(
            exposedAt +
              (inSession ? 5_000 + rand() * 600_000 : rand() * 0.8 * DAY_MS),
          ),
          properties: {
            item_id: item.itemId,
            interleave_id: inSession ? interleaveId : null,
            value: product.price,
          },
        });
      }
    }
  }
  return rows;
}

async function loadPostgres(rows: EventRow[]) {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    await client.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await client.query(`CREATE TABLE ${TABLE} (
      user_id text NOT NULL,
      event_name text NOT NULL,
      received_at timestamptz NOT NULL,
      properties jsonb NOT NULL
    )`);
    await client.query(
      `INSERT INTO ${TABLE} (user_id, event_name, received_at, properties)
       SELECT u, e, r, p::jsonb
       FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::text[])
         AS t(u, e, r, p)`,
      [
        rows.map((r) => r.userId),
        rows.map((r) => r.eventName),
        rows.map((r) => r.receivedAt.toISOString()),
        rows.map((r) => JSON.stringify(r.properties)),
      ],
    );
  } finally {
    await client.end();
  }
}

async function api<T>(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_HOST}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `${method} ${path} failed (${res.status}): ${json.message ?? JSON.stringify(json)}`,
    );
  }
  return json as T;
}

type SnapshotMetric = {
  users: number;
  cr: number;
  ci?: [number, number];
  pValue?: number;
  uplift?: { mean?: number };
  errorMessage?: string;
};
type Snapshot = {
  id: string;
  status: "pending" | "running" | "success" | "error";
  error?: string;
  results?: {
    variations: { metrics: Record<string, SnapshotMetric> }[];
  }[];
};

async function waitForSnapshot(interleavingId: string): Promise<Snapshot> {
  // 5s keeps two pollers well under the 60 requests/minute API key limit
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const { snapshot } = await api<{ snapshot: Snapshot }>(
      "GET",
      `/interleaving/${interleavingId}/snapshot`,
    );
    if (snapshot.status === "success" || snapshot.status === "error") {
      return snapshot;
    }
  }
  throw new Error(`Timed out waiting for interleaving ${interleavingId}`);
}

async function main() {
  if (!API_KEY || !DATASOURCE_ID) {
    throw new Error("GB_API_KEY and GB_DATASOURCE_ID are required");
  }

  const rows = generateEvents();
  await loadPostgres(rows);
  console.log(`Loaded ${rows.length} events into ${TABLE}`);

  const { factTable } = await api<{ factTable: { id: string } }>(
    "POST",
    "/fact-tables",
    {
      name: "Interleaving demo: Add to Cart",
      datasource: DATASOURCE_ID,
      userIdTypes: ["user_id"],
      sql: FACT_TABLE_SQL,
      columns: [
        { column: "user_id", datatype: "string" },
        { column: "timestamp", datatype: "date" },
        { column: "item_id", datatype: "string" },
        { column: "interleave_id", datatype: "string" },
        { column: "value", datatype: "number" },
      ],
    },
  );
  const metricBodies = [
    {
      name: "Interleaving demo: Added to cart",
      metricType: "proportion",
      numerator: { factTableId: factTable.id },
    },
    {
      name: "Interleaving demo: Cart value",
      metricType: "mean",
      numerator: {
        factTableId: factTable.id,
        column: "value",
        aggregation: "sum",
      },
    },
  ];
  const metrics: { id: string; name: string }[] = [];
  for (const body of metricBodies) {
    const { factMetric } = await api<{
      factMetric: { id: string; name: string };
    }>("POST", "/fact-metrics", body);
    metrics.push(factMetric);
  }

  const { interleavingQuery } = await api<{
    interleavingQuery: { id: string };
  }>("POST", "/interleaving-queries", {
    datasourceId: DATASOURCE_ID,
    name: "Interleaving demo exposures",
    userIdTypes: ["user_id"],
    query: EXPOSURE_QUERY,
  });
  console.log(
    `Created fact table ${factTable.id}, metrics ${metrics.map((m) => m.id).join(", ")}, interleaving query ${interleavingQuery.id}`,
  );

  // Results are keyed by metric id, so each attribution type gets its own
  // analysis rather than sharing one snapshot
  const analyses = (["paired", "ownershipByExposureCount"] as const).map(
    (attributionType) => ({
      interleavingId: `interleaving-demo-${attributionType}`,
      attributionType,
    }),
  );
  const startDate = new Date(Date.now() - 15 * DAY_MS).toISOString();
  for (const { interleavingId, attributionType } of analyses) {
    const { snapshot } = await api<{ snapshot: Snapshot }>(
      "POST",
      `/interleaving/${interleavingId}/update`,
      {
        trackingKey: TRACKING_KEY,
        interleavingQueryId: interleavingQuery.id,
        userIdType: "user_id",
        variationNames: VARIATIONS,
        metrics: metrics.map((m) => ({ id: m.id, attributionType })),
        startDate,
        endDate: null,
      },
    );
    console.log(`Started ${interleavingId}: snapshot ${snapshot.id}`);
  }

  const snapshots = await Promise.all(
    analyses.map((a) => waitForSnapshot(a.interleavingId)),
  );
  analyses.forEach(({ attributionType }, i) => {
    const snapshot = snapshots[i];
    console.log(`\n${attributionType}: ${snapshot.status}`);
    if (snapshot.status === "error") {
      console.log(snapshot.error);
      return;
    }
    const [control, treatment] = snapshot.results?.[0]?.variations ?? [];
    console.table(
      metrics.map((m) => {
        const c = control?.metrics[m.id];
        const t = treatment?.metrics[m.id];
        return {
          metric: m.name,
          users: t?.users,
          [VARIATIONS[0]]: c?.cr,
          [VARIATIONS[1]]: t?.cr,
          uplift: t?.uplift?.mean,
          ci: t?.ci?.join(" to "),
          pValue: t?.pValue,
          error: t?.errorMessage,
        };
      }),
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
