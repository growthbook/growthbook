import { Snowflake } from "snowflake-promise";
import { SnowflakeConnectionParams } from "../../types/integrations/snowflake";

type ProxyOptions = {
  proxyHost?: string;
  proxyPassword?: string;
  proxyUser?: string;
  proxyPort?: number;
  proxyProtocol?: string;
};
function getProxySettings(): ProxyOptions {
  const uri = process.env.SNOWFLAKE_PROXY;
  if (!uri) return {};

  const parsed = new URL(uri);
  return {
    proxyProtocol: parsed.protocol,
    proxyHost: parsed.hostname,
    proxyPort: (parsed.port ? parseInt(parsed.port) : 0) || undefined,
    proxyUser: parsed.username || undefined,
    proxyPassword: parsed.password || undefined,
  };
}

export async function runSnowflakeQuery<T>(
  conn: SnowflakeConnectionParams,
  sql: string,
  values: string[] = []
): Promise<T[]> {
  const snowflake = new Snowflake({
    account: conn.account,
    username: conn.username,
    password: conn.password,
    database: conn.database,
    schema: conn.schema,
    warehouse: conn.warehouse,
    role: conn.role,
    ...getProxySettings(),
  });

  await snowflake.connect();
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
