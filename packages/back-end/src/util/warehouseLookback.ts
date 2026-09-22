/**
 * How far back a "last received" / "last evaluated" lookup scans.
 *
 * It has to reach past any selected window for the value to mean anything, but
 * an unbounded `max(timestamp)` over a raw events table is far too expensive to
 * run on every page load.
 *
 * Shared by the Event Logs summary and the feature usage summary so the two
 * surfaces cannot drift apart on how far back they look. It also bounds what
 * either surface may claim: neither can say "never", only "not in the last N
 * days" — which is the only thing a bounded scan actually establishes.
 *
 * Lives in `util/` rather than beside either caller so neither has to import
 * the other: `services/clickhouse.ts` already imports `integrations/`, and the
 * reverse import would make that a cycle waiting to happen.
 */
export const LAST_RECEIVED_LOOKBACK_DAYS = 90;
