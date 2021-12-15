import { Snowflake } from "snowflake-promise";
import { SnowflakeConnectionParams } from "../../types/integrations/snowflake";

export async function getSnowflakeClient(conn: SnowflakeConnectionParams) {
  const snowflake = new Snowflake({
    account: conn.account,
    username: conn.username,
    password: conn.password,
    database: conn.database,
    schema: conn.schema,
    warehouse: conn.warehouse,
    role: conn.role,
  });

  await snowflake.connect();

  return snowflake;
}

export async function runSnowflakeQuery<T>(
  snowflake: Snowflake,
  sql: string,
  values: string[] = []
): Promise<T[]> {
  const res = await snowflake.execute(sql, values);

  // Annoyingly, Snowflake turns all column names into all caps
  // Need to lowercase them here so they match other data sources
  const lowercase: T[] = [];
  res.forEach((row) => {
    // eslint-disable-next-line
    const o: any = {};
    Object.keys(row).forEach((k) => {
      o[k.toLowerCase()] = row[k];
    });
    lowercase.push(o);
  });

  return lowercase;
}
