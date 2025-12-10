import mssql from "mssql";
import { MssqlConnectionParams } from "shared/types/integrations/mssql";
const pools = new Map();

export function findOrCreateConnection(
  name: string,
  config: MssqlConnectionParams,
) {
  if (!pools.has(name)) {
    const pool: mssql.ConnectionPool = new mssql.ConnectionPool(config);
    // automatically remove the pool from the cache if `pool.close()` is called
    const close = pool.close.bind(pool);
    pool.close = () => {
      pools.delete(name);
      return close();
    };
    pools.set(name, pool.connect());
  }
  return pools.get(name);
}
