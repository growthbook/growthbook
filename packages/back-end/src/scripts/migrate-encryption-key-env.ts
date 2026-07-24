// Imported first by migrate-encryption-key.ts, before any module reads these at
// load time. The migration only touches Mongo, so turn off cron job processing
// (secrets.ts CRON_ENABLED) and the eager stats-engine Python pool (python.ts
// MIN_POOL_SIZE) it would otherwise start and never use. An explicit env wins.
process.env.CRON_DISABLED = process.env.CRON_DISABLED ?? "true";
process.env.GB_STATS_ENGINE_MIN_POOL_SIZE =
  process.env.GB_STATS_ENGINE_MIN_POOL_SIZE ?? "0";
