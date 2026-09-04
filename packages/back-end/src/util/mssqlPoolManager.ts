import { createHash } from "crypto";
import mssql from "mssql";
import { MssqlConnectionParams } from "shared/types/integrations/mssql";
import { logger } from "back-end/src/util/logger";

type PoolEntry = {
  configKey: string;
  pool: mssql.ConnectionPool;
  connected: Promise<mssql.ConnectionPool>;
};

const pools = new Map<string, PoolEntry>();

export function findOrCreateConnection(
  datasourceId: string,
  config: MssqlConnectionParams,
): Promise<mssql.ConnectionPool> {
  const existing = pools.get(datasourceId);

  const configKey = createHash("sha256")
    .update(JSON.stringify(config))
    .digest("hex");
  if (existing?.configKey === configKey) {
    return existing.connected;
  }

  // Config changed: replace the stale pool
  if (existing) {
    void closeMssqlPool(datasourceId);
  }

  const pool = new mssql.ConnectionPool(config);
  pool.on("error", (err) => {
    logger.warn(err, `MSSQL pool error for datasource ${datasourceId}`);
  });
  const connected = pool.connect().catch((e) => {
    // Evict so the next query retries instead of replaying this rejection
    if (pools.get(datasourceId)?.pool === pool) {
      pools.delete(datasourceId);
    }
    throw e;
  });
  pools.set(datasourceId, { configKey, pool, connected });
  return connected;
}

export async function closeMssqlPool(datasourceId: string): Promise<void> {
  const entry = pools.get(datasourceId);
  if (!entry) return;
  pools.delete(datasourceId);
  // mssql rejects close() while connecting, so wait for connect to settle
  await entry.connected.catch(() => undefined);
  await entry.pool.close().catch((e) => {
    logger.warn(e, `Failed to close MSSQL pool for datasource ${datasourceId}`);
  });
}
