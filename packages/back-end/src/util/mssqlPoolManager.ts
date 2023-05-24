import mssql from "mssql";
import { MssqlConnectionParams } from "../../types/integrations/mssql";
const pools = new Map();

export function findOrCreateConnection(
  name: string,
  config: MssqlConnectionParams
) {
  if (!pools.has(name)) {
    const pool: mssql.ConnectionPool = new mssql.ConnectionPool(config);
    pools.set(name, pool.connect());
  }
  return pools.get(name);
}
