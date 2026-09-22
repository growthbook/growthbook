// Local-only fixture data for the Event Logs page.
//
// The real implementation in `clickhouse.ts` queries the managed warehouse
// (`events`, `experiment_views`, `feature_usage`). Local dev has no ClickHouse
// and no `growthbook_clickhouse` datasource, so both queries return [] and the
// page renders empty. Setting EVENT_LOGS_FIXTURES=1 swaps in the generated
// corpus below, matching the real filter/order semantics so the UI behaves the
// same way it would against the warehouse.
//
// Never enable this outside local development.

import { EVENT_LOGS_FIXTURES } from "back-end/src/util/secrets";
import type {
  EventLogRecordRow,
  EventLogSummaryRow,
} from "back-end/src/services/clickhouse";

export function eventLogFixturesEnabled(): boolean {
  return EVENT_LOGS_FIXTURES;
}

const CORPUS_DAYS = 14;
// The records endpoint caps its window at 24h and defaults to 1h, so the most
// recent day is generated denser to keep the stream from looking empty.
const RECENT_BOOST_HOURS = 24;
const RECENT_BOOST_FACTOR = 4;

const USER_POOL_SIZE = 600;

// The corpus only models the two built-in identity columns. A real warehouse
// resolves this list from the data source's attribute schema — see
// getManagedWarehouseUserIdTypes in the live query.
const FIXTURE_IDENTIFIERS = ["user_id", "device_id"] as const;

type EventSpec = {
  name: string;
  /** Relative frequency within the `events` table. */
  weight: number;
  urls: string[];
  properties: (rand: Rand) => Record<string, unknown>;
};

const ENVIRONMENTS: Array<[string, number]> = [
  ["production", 78],
  ["staging", 13],
  ["dev", 9],
];

const COUNTRIES: Array<[string, number]> = [
  ["US", 38],
  ["GB", 12],
  ["DE", 9],
  ["CA", 7],
  ["FR", 6],
  ["IN", 6],
  ["AU", 5],
  ["BR", 5],
  ["NL", 4],
  ["JP", 4],
  ["SE", 2],
  ["ES", 2],
];

const BROWSERS: Array<[string, number]> = [
  ["Chrome", 62],
  ["Safari", 18],
  ["Firefox", 9],
  ["Edge", 8],
  ["Opera", 3],
];

const OSES: Array<[string, number]> = [
  ["macOS", 41],
  ["Windows", 30],
  ["iOS", 13],
  ["Android", 10],
  ["Linux", 6],
];

const DEVICE_TYPES: Array<[string, number]> = [
  ["desktop", 72],
  ["mobile", 22],
  ["tablet", 6],
];

const SDKS: Array<[string, number]> = [
  ["javascript", 34],
  ["react", 28],
  ["nodejs", 14],
  ["python", 9],
  ["go", 6],
  ["ruby", 4],
  ["php", 3],
  ["java", 2],
];

// A couple of events deliberately stop arriving partway through the corpus, so
// the "Last received" column has something to show: healthy-looking totals over
// a 7- or 14-day window, but nothing received for days. Values are "no events
// newer than N hours ago".
const SILENT_AFTER_HOURS_AGO: Record<string, number> = {
  // Exactly one, so "Stopped arriving" matches some rows and not all.
  "Data Source Connected": 72,
};

// Mirror of SILENT_AFTER_HOURS_AGO for the other end: this event only starts
// partway through the corpus, so it reads as "new" in a 7-day window.
const BORN_HOURS_AGO: Record<string, number> = {
  "Search Performed": 72,
};

const SDK_VERSIONS = ["1.7.0", "1.6.5", "1.6.2", "1.5.4"];
const PLANS = ["starter", "pro", "enterprise", "trial"];

const REFERRERS = [
  "https://www.google.com/",
  "https://github.com/growthbook/growthbook",
  "https://news.ycombinator.com/",
  "https://docs.growthbook.io/",
  "",
];

const FEATURE_KEYS = [
  "new-onboarding-flow",
  "checkout-redesign",
  "ai-assisted-setup",
  "sdk-connection-wizard",
  "event-logs",
  "session-replays",
  "pricing-page-v2",
  "dark-mode",
];

const EXPERIMENT_KEYS = [
  "onboarding-checklist-order",
  "pricing-cta-copy",
  "signup-form-length",
  "docs-search-placement",
  "empty-state-illustration",
];

// Event catalog modelled on GrowthBook's own product surface, plus the
// commerce-style events the app's demo data uses.
const EVENT_SPECS: EventSpec[] = [
  {
    name: "Page View",
    weight: 100,
    urls: [
      "https://app.growthbook.io/getstarted",
      "https://app.growthbook.io/features",
      "https://app.growthbook.io/experiments",
      "https://app.growthbook.io/metrics",
      "https://app.growthbook.io/sdks",
      "https://app.growthbook.io/dashboard",
    ],
    properties: (r) => ({
      path: r.pick([
        "/getstarted",
        "/features",
        "/experiments",
        "/metrics",
        "/sdks",
        "/dashboard",
      ]),
      referrer: r.pick(REFERRERS),
      loadTimeMs: r.int(180, 2400),
    }),
  },
  {
    name: "Button Clicked",
    weight: 58,
    urls: [
      "https://app.growthbook.io/features",
      "https://app.growthbook.io/experiments",
      "https://app.growthbook.io/getstarted",
    ],
    properties: (r) => ({
      label: r.pick([
        "Add Feature",
        "New Experiment",
        "Connect SDK",
        "Invite Teammate",
        "Run Query",
        "Save Changes",
      ]),
      section: r.pick(["header", "empty-state", "sidebar", "modal-footer"]),
    }),
  },
  {
    name: "Search Performed",
    weight: 22,
    urls: ["https://app.growthbook.io/features"],
    properties: (r) => ({
      query: r.pick([
        "checkout",
        "onboarding",
        "revenue",
        "sdk",
        "holdout",
        "retention",
      ]),
      resultCount: r.int(0, 48),
    }),
  },
  {
    name: "Signup Started",
    weight: 14,
    urls: ["https://www.growthbook.io/signup"],
    properties: (r) => ({
      source: r.pick(["docs", "pricing", "github", "direct"]),
      inviteToken: r.bool(0.18),
    }),
  },
  {
    name: "Signup Completed",
    weight: 9,
    urls: ["https://www.growthbook.io/signup"],
    properties: (r) => ({
      plan: r.pick(PLANS),
      seats: r.int(1, 12),
      source: r.pick(["docs", "pricing", "github", "direct"]),
    }),
  },
  {
    name: "Onboarding Step Completed",
    weight: 17,
    urls: ["https://app.growthbook.io/getstarted"],
    properties: (r) => ({
      step: r.pick([
        "create-account",
        "connect-sdk",
        "create-feature",
        "connect-datasource",
        "invite-team",
      ]),
      stepIndex: r.int(1, 5),
      skipped: r.bool(0.2),
    }),
  },
  {
    name: "Feature Flag Created",
    weight: 12,
    urls: ["https://app.growthbook.io/features"],
    properties: (r) => ({
      featureKey: r.pick(FEATURE_KEYS),
      valueType: r.pick(["boolean", "string", "number", "json"]),
      hasDefaultRule: r.bool(0.75),
    }),
  },
  {
    name: "Feature Flag Toggled",
    weight: 26,
    urls: ["https://app.growthbook.io/features"],
    properties: (r) => ({
      featureKey: r.pick(FEATURE_KEYS),
      environment: r.pick(["production", "staging", "dev"]),
      enabled: r.bool(0.55),
    }),
  },
  {
    name: "Experiment Started",
    weight: 8,
    urls: ["https://app.growthbook.io/experiments"],
    properties: (r) => ({
      experimentKey: r.pick(EXPERIMENT_KEYS),
      variations: r.int(2, 4),
      trafficPercent: r.pick([10, 25, 50, 100]),
    }),
  },
  {
    name: "Experiment Results Viewed",
    weight: 31,
    urls: ["https://app.growthbook.io/experiments"],
    properties: (r) => ({
      experimentKey: r.pick(EXPERIMENT_KEYS),
      engine: r.pick(["bayesian", "frequentist"]),
      daysRunning: r.int(1, 28),
    }),
  },
  {
    name: "Metric Created",
    weight: 7,
    urls: ["https://app.growthbook.io/metrics"],
    properties: (r) => ({
      metricType: r.pick(["binomial", "count", "revenue", "duration"]),
      isFactMetric: r.bool(0.7),
    }),
  },
  {
    name: "SDK Connection Created",
    weight: 6,
    urls: ["https://app.growthbook.io/sdks"],
    properties: (r) => ({
      language: r.pick(["javascript", "react", "nodejs", "python", "go"]),
      environment: r.pick(["production", "staging", "dev"]),
      encrypted: r.bool(0.35),
    }),
  },
  {
    name: "Data Source Connected",
    weight: 4,
    urls: ["https://app.growthbook.io/datasources"],
    properties: (r) => ({
      type: r.pick(["postgres", "bigquery", "snowflake", "clickhouse"]),
      testPassed: r.bool(0.85),
    }),
  },
  {
    name: "Checkout Started",
    weight: 11,
    urls: ["https://www.growthbook.io/pricing"],
    properties: (r) => ({
      plan: r.pick(["pro", "enterprise"]),
      seats: r.int(3, 40),
      billingPeriod: r.pick(["monthly", "annual"]),
    }),
  },
  {
    name: "Checkout Completed",
    weight: 5,
    urls: ["https://www.growthbook.io/pricing"],
    properties: (r) => ({
      plan: r.pick(["pro", "enterprise"]),
      seats: r.int(3, 40),
      billingPeriod: r.pick(["monthly", "annual"]),
      amountUsd: r.int(60, 4800),
      currency: "USD",
    }),
  },
  {
    name: "Subscription Upgraded",
    weight: 3,
    urls: ["https://app.growthbook.io/settings/billing"],
    properties: (r) => ({
      fromPlan: "starter",
      toPlan: r.pick(["pro", "enterprise"]),
      amountUsd: r.int(120, 6000),
    }),
  },
];

/** Deterministic PRNG so paging and sparklines stay stable across requests. */
class Rand {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  bool(trueProbability = 0.5): boolean {
    return this.next() < trueProbability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T>(items: ReadonlyArray<[T, number]>): T {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.next() * total;
    for (const [value, weight] of items) {
      roll -= weight;
      if (roll <= 0) return value;
    }
    return items[items.length - 1][0];
  }
}

/** Traffic shape by hour of day (UTC), peaking during US/EU working hours. */
const HOURLY_SHAPE = [
  0.25, 0.18, 0.15, 0.14, 0.16, 0.22, 0.35, 0.52, 0.74, 0.92, 1.05, 1.12, 1.15,
  1.18, 1.22, 1.2, 1.1, 0.95, 0.82, 0.7, 0.6, 0.5, 0.4, 0.32,
];

function hourWeight(date: Date): number {
  const day = date.getUTCDay();
  const weekendFactor = day === 0 || day === 6 ? 0.45 : 1;
  return HOURLY_SHAPE[date.getUTCHours()] * weekendFactor;
}

/** ClickHouse renders DateTime as `YYYY-MM-DD HH:MM:SS` in UTC. */
function toClickhouseTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function pseudoUuid(rand: Rand): string {
  const hex = (len: number) =>
    Array.from({ length: len }, () => rand.int(0, 15).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

type Corpus = {
  /** `events` table rows. */
  events: EventLogRecordRow[];
  /** `experiment_views` table rows, surfaced as "Experiment Viewed". */
  experimentViews: EventLogRecordRow[];
  /** `feature_usage` table rows, surfaced as "Feature Evaluated". */
  featureUsage: EventLogRecordRow[];
  generatedAt: Date;
};

let cachedCorpus: Corpus | null = null;

// The corpus is generated relative to "now", so a cached one ages: leave the
// page open and every row drifts toward stale, and "Last 1 hour" empties out.
// Rebuilding once the anchor drifts keeps the data current at request time
// without regenerating ~25k rows on every keystroke.
const CORPUS_MAX_AGE_MS = 60 * 1000;

function buildIdentity(rand: Rand) {
  const userIndex = rand.int(1, USER_POOL_SIZE);
  return {
    user_id: `usr_${String(userIndex).padStart(4, "0")}`,
    device_id: `dev_${String(rand.int(1, USER_POOL_SIZE * 2)).padStart(5, "0")}`,
    environment: rand.weighted(ENVIRONMENTS),
    geo_country: rand.weighted(COUNTRIES),
    ua_browser: rand.weighted(BROWSERS),
    ua_os: rand.weighted(OSES),
    ua_device_type: rand.weighted(DEVICE_TYPES),
    sdk_language: rand.weighted(SDKS),
    sdk_version: rand.pick(SDK_VERSIONS),
    attributes: {
      id: `usr_${String(userIndex).padStart(4, "0")}`,
      plan: PLANS[userIndex % PLANS.length],
      country: rand.weighted(COUNTRIES),
      loggedIn: rand.bool(0.82),
      employee: rand.bool(0.06),
    } as Record<string, unknown>,
  };
}

function generateCorpus(): Corpus {
  const rand = new Rand(0x5eed1234);
  const generatedAt = new Date();

  // Anchor to the top of the current hour so repeated builds within a process
  // produce a stable grid of buckets.
  const anchor = new Date(generatedAt);
  anchor.setUTCMinutes(0, 0, 0);

  const events: EventLogRecordRow[] = [];
  const experimentViews: EventLogRecordRow[] = [];
  const featureUsage: EventLogRecordRow[] = [];

  const eventWeights: Array<[EventSpec, number]> = EVENT_SPECS.map((s) => [
    s,
    s.weight,
  ]);

  const totalHours = CORPUS_DAYS * 24;
  for (let hoursAgo = 0; hoursAgo < totalHours; hoursAgo++) {
    const bucketStart = new Date(anchor.getTime() - hoursAgo * 3600_000);
    const weight = hourWeight(bucketStart);
    const boost = hoursAgo < RECENT_BOOST_HOURS ? RECENT_BOOST_FACTOR : 1;

    const eventCount = Math.round(20 * weight * boost);
    const experimentCount = Math.round(9 * weight * boost);
    const featureCount = Math.round(34 * weight * boost);

    const spreadWithinHour = (): Date =>
      new Date(bucketStart.getTime() + rand.int(0, 3599) * 1000);

    for (let i = 0; i < eventCount; i++) {
      const spec = rand.weighted(eventWeights);
      const silentAfter = SILENT_AFTER_HOURS_AGO[spec.name];
      if (silentAfter !== undefined && hoursAgo < silentAfter) continue;
      const bornAt = BORN_HOURS_AGO[spec.name];
      if (bornAt !== undefined && hoursAgo >= bornAt) continue;
      const identity = buildIdentity(rand);
      const ts = spreadWithinHour();
      if (ts > generatedAt) continue;
      events.push({
        event_uuid: pseudoUuid(rand),
        timestamp: toClickhouseTimestamp(ts),
        event_name: spec.name,
        ...identity,
        properties: spec.properties(rand),
        url: rand.pick(spec.urls),
      });
    }

    for (let i = 0; i < experimentCount; i++) {
      const identity = buildIdentity(rand);
      const ts = spreadWithinHour();
      if (ts > generatedAt) continue;
      const experimentKey = rand.pick(EXPERIMENT_KEYS);
      const variationId = rand.int(0, 2);
      experimentViews.push({
        event_uuid: pseudoUuid(rand),
        timestamp: toClickhouseTimestamp(ts),
        event_name: "Experiment Viewed",
        ...identity,
        properties: {
          experimentId: experimentKey,
          variationId,
          variationName: ["control", "variation-1", "variation-2"][variationId],
        },
        url: `https://app.growthbook.io/experiment/${experimentKey}`,
      });
    }

    // feature_usage is a narrow table: everything outside timestamp /
    // environment is NULL-filled by the real query, so mirror that exactly.
    for (let i = 0; i < featureCount; i++) {
      const ts = spreadWithinHour();
      if (ts > generatedAt) continue;
      const environment = rand.weighted(ENVIRONMENTS);
      featureUsage.push({
        event_uuid: `feature-usage-${rand.int(1_000_000, 9_999_999_999)}`,
        timestamp: toClickhouseTimestamp(ts),
        event_name: "Feature Evaluated",
        user_id: null,
        device_id: null,
        environment,
        properties: {},
        attributes: {},
        url: null,
        geo_country: null,
        ua_browser: null,
        ua_os: null,
        ua_device_type: null,
        sdk_language: null,
        sdk_version: null,
      });
    }
  }

  // The newest bucket covers only the elapsed part of the current hour, so at
  // HH:01 there is almost nothing to show. Seed the last few minutes directly so
  // the Log Stream always has content at "Last 1 hour" and Last Received reads
  // in minutes rather than hours.
  for (let i = 0; i < 90; i++) {
    const spec = rand.weighted(eventWeights);
    if (SILENT_AFTER_HOURS_AGO[spec.name] !== undefined) continue;
    const identity = buildIdentity(rand);
    const ts = new Date(generatedAt.getTime() - rand.int(5, 14 * 60) * 1000);
    events.push({
      event_uuid: pseudoUuid(rand),
      timestamp: toClickhouseTimestamp(ts),
      event_name: spec.name,
      ...identity,
      properties: spec.properties(rand),
      url: rand.pick(spec.urls),
    });
  }
  for (let i = 0; i < 40; i++) {
    const ts = new Date(generatedAt.getTime() - rand.int(5, 14 * 60) * 1000);
    featureUsage.push({
      event_uuid: `feature-usage-${rand.int(1_000_000, 9_999_999_999)}`,
      timestamp: toClickhouseTimestamp(ts),
      event_name: "Feature Evaluated",
      user_id: null,
      device_id: null,
      environment: rand.weighted(ENVIRONMENTS),
      properties: {},
      attributes: {},
      url: null,
      geo_country: null,
      ua_browser: null,
      ua_os: null,
      ua_device_type: null,
      sdk_language: null,
      sdk_version: null,
    });
  }

  const byTimestampDesc = (a: EventLogRecordRow, b: EventLogRecordRow) =>
    a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0;

  events.sort(byTimestampDesc);
  experimentViews.sort(byTimestampDesc);
  featureUsage.sort(byTimestampDesc);

  return { events, experimentViews, featureUsage, generatedAt };
}

export function getFixtureCorpus(): Corpus {
  const stale =
    !!cachedCorpus &&
    Date.now() - cachedCorpus.generatedAt.getTime() > CORPUS_MAX_AGE_MS;
  if (!cachedCorpus || stale) {
    cachedCorpus = generateCorpus();
  }
  return cachedCorpus;
}

/** Exposed for the verification script; forces a fresh build. */
export function rebuildFixtureCorpus(): Corpus {
  cachedCorpus = null;
  return getFixtureCorpus();
}

function withinWindow(
  row: EventLogRecordRow,
  dateFrom: string,
  dateTo: string,
): boolean {
  // Timestamps are `YYYY-MM-DD HH:MM:SS` UTC, so lexical compare would work,
  // but the incoming bounds are ISO strings — compare as epoch instead.
  const ts = Date.parse(`${row.timestamp.replace(" ", "T")}Z`);
  return ts >= Date.parse(dateFrom) && ts < Date.parse(dateTo);
}

/**
 * Mirrors `listEventLogSummary`: UNION of the three tables, grouped by event
 * name, ordered by total count desc. `dau_count` is the average of each day's
 * distinct user count, and `feature_usage` contributes 0 DAU (it has no
 * user_id), exactly as the real query does.
 */
export function listEventLogSummaryFixtures(options: {
  dateFrom: string;
  dateTo: string;
  search?: string;
  environment?: string;
  limit: number;
  offset: number;
}): EventLogSummaryRow[] {
  const corpus = getFixtureCorpus();

  type Bucket = {
    counts: Map<string, number>;
    users: Map<string, Set<string>>;
    firstSeen: string | null;
    // Keyed by identifier name; the corpus only carries the built-ins.
    identifierNonNull: Map<string, number>;
  };
  const buckets = new Map<string, Bucket>();
  // Most recent timestamp per event name, scoped by environment but NOT by the
  // window, matching the lookback join in the real query.
  const lastReceived = new Map<string, string>();
  // Earliest across the whole corpus, not the window — mirrors the lookback
  // min(timestamp) the real query joins in.
  const firstEver = new Map<string, string>();

  const matchesEnvironment = (row: EventLogRecordRow) =>
    !options.environment || row.environment === options.environment;

  const add = (row: EventLogRecordRow, countsDau: boolean) => {
    if (!matchesEnvironment(row)) return;

    const seen = lastReceived.get(row.event_name);
    if (!seen || row.timestamp > seen) {
      lastReceived.set(row.event_name, row.timestamp);
    }
    const earliest = firstEver.get(row.event_name);
    if (!earliest || row.timestamp < earliest) {
      firstEver.set(row.event_name, row.timestamp);
    }

    if (!withinWindow(row, options.dateFrom, options.dateTo)) return;
    const day = row.timestamp.slice(0, 10);
    let bucket = buckets.get(row.event_name);
    if (!bucket) {
      bucket = {
        counts: new Map(),
        users: new Map(),
        firstSeen: null,
        identifierNonNull: new Map(),
      };
      buckets.set(row.event_name, bucket);
    }
    bucket.counts.set(day, (bucket.counts.get(day) ?? 0) + 1);

    // Window-bounded, unlike lastReceived above.
    if (!bucket.firstSeen || row.timestamp < bucket.firstSeen) {
      bucket.firstSeen = row.timestamp;
    }

    for (const identifier of FIXTURE_IDENTIFIERS) {
      const value = identifier === "user_id" ? row.user_id : row.device_id;
      if (value !== null) {
        bucket.identifierNonNull.set(
          identifier,
          (bucket.identifierNonNull.get(identifier) ?? 0) + 1,
        );
      }
    }
    if (countsDau && row.user_id) {
      let set = bucket.users.get(day);
      if (!set) {
        set = new Set();
        bucket.users.set(day, set);
      }
      set.add(row.user_id);
    }
  };

  corpus.events.forEach((r) => add(r, true));
  corpus.experimentViews.forEach((r) => add(r, true));
  corpus.featureUsage.forEach((r) => add(r, false));

  const search = options.search?.toLowerCase();

  const rows: EventLogSummaryRow[] = [...buckets.entries()]
    .filter(([eventName]) =>
      search ? eventName.toLowerCase().includes(search) : true,
    )
    .map(([eventName, bucket]) => {
      const days = [...bucket.counts.keys()].sort();
      const total = days.reduce(
        (sum, d) => sum + (bucket.counts.get(d) ?? 0),
        0,
      );
      const dauValues = days.map((d) => bucket.users.get(d)?.size ?? 0);
      const avgDau = dauValues.length
        ? dauValues.reduce((a, b) => a + b, 0) / dauValues.length
        : 0;
      return {
        event_name: eventName,
        total_count: String(total),
        dau_count: String(avgDau),
        daily_counts: days.map((d) => String(bucket.counts.get(d) ?? 0)),
        last_received: lastReceived.get(eventName) ?? null,
        first_seen: bucket.firstSeen,
        first_ever_seen: firstEver.get(eventName) ?? null,
        identifiers: [...FIXTURE_IDENTIFIERS],
        identifier_non_null_counts: FIXTURE_IDENTIFIERS.map((id) =>
          String(bucket.identifierNonNull.get(id) ?? 0),
        ),
      };
    })
    .sort((a, b) => Number(b.total_count) - Number(a.total_count));

  const limit = Math.max(1, Math.min(100, Math.floor(options.limit)));
  const offset = Math.max(0, Math.floor(options.offset));
  return rows.slice(offset, offset + limit);
}

/**
 * Mirrors `listEventLogRecords`, including the table routing on exact
 * `eventName` match and the feature_usage unsupported-filter short circuit.
 */
export function listEventLogRecordsFixtures(options: {
  dateFrom: string;
  dateTo: string;
  eventName?: string;
  userId?: string;
  environment?: string;
  browser?: string;
  os?: string;
  country?: string;
  sdk?: string;
  limit: number;
  offset: number;
}): EventLogRecordRow[] {
  const corpus = getFixtureCorpus();

  const hasUnsupportedFeatureUsageFilter = Boolean(
    options.userId ||
      options.browser ||
      options.os ||
      options.country ||
      options.sdk,
  );

  const matchesShared = (row: EventLogRecordRow): boolean => {
    if (!withinWindow(row, options.dateFrom, options.dateTo)) return false;
    if (options.userId && row.user_id !== options.userId) return false;
    if (options.environment && row.environment !== options.environment) {
      return false;
    }
    if (options.browser && row.ua_browser !== options.browser) return false;
    if (options.os && row.ua_os !== options.os) return false;
    if (options.country && row.geo_country !== options.country) return false;
    if (options.sdk && row.sdk_language !== options.sdk) return false;
    return true;
  };

  const matchesFeatureUsage = (row: EventLogRecordRow): boolean => {
    if (!withinWindow(row, options.dateFrom, options.dateTo)) return false;
    if (options.environment && row.environment !== options.environment) {
      return false;
    }
    return true;
  };

  let rows: EventLogRecordRow[];

  if (options.eventName === "Experiment Viewed") {
    rows = corpus.experimentViews.filter(matchesShared);
  } else if (options.eventName === "Feature Evaluated") {
    if (hasUnsupportedFeatureUsageFilter) return [];
    rows = corpus.featureUsage.filter(matchesFeatureUsage);
  } else if (options.eventName) {
    rows = corpus.events.filter(
      (r) => r.event_name === options.eventName && matchesShared(r),
    );
  } else {
    rows = [
      ...corpus.events.filter(matchesShared),
      ...corpus.experimentViews.filter(matchesShared),
      ...(hasUnsupportedFeatureUsageFilter
        ? []
        : corpus.featureUsage.filter(matchesFeatureUsage)),
    ].sort((a, b) =>
      a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0,
    );
  }

  const limit = Math.max(1, Math.min(100, Math.floor(options.limit)));
  const offset = Math.max(0, Math.floor(options.offset));
  return rows.slice(offset, offset + limit);
}
