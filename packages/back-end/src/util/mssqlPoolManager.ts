import mssql from "mssql";
import { MssqlConnectionParams } from "../../types/integrations/mssql";
const pools = new Map();

export function get(name: string, config: MssqlConnectionParams) {
  if (!pools.has(name)) {
    if (!config) {
      throw new Error("Pool does not exist");
    }
    const pool: mssql.ConnectionPool = new mssql.ConnectionPool(config);
    pools.set(name, pool.connect());
  }
  return pools.get(name);
}
