// A write guard built from a doc as it's stored in Mongo, so it only matches
// that version. Build it from the raw doc, not a migrated one: a legacy doc may
// have no dateUpdated, which migrations fill in memory only, and a guard on the
// filled value would never match. `null` matches a missing field too, and the
// guarded write stamps a real dateUpdated.
export function storedVersionGuard(stored: { dateUpdated?: unknown }): {
  dateUpdated: Date | null;
} {
  return {
    dateUpdated: stored.dateUpdated instanceof Date ? stored.dateUpdated : null,
  };
}
