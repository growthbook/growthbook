import { AES, enc } from "crypto-js";
import { ENCRYPTION_KEY } from "../util/secrets";
import GoogleAnalytics from "../integrations/GoogleAnalytics";
import Athena from "../integrations/Athena";
import Presto from "../integrations/Presto";
import Redshift from "../integrations/Redshift";
import Snowflake from "../integrations/Snowflake";
import Postgres from "../integrations/Postgres";
import { SourceIntegrationInterface } from "../types/Integration";
import BigQuery from "../integrations/BigQuery";
import ClickHouse from "../integrations/ClickHouse";
import Mixpanel from "../integrations/Mixpanel";
import { DataSourceInterface, DataSourceParams } from "../../types/datasource";
import Mysql from "../integrations/Mysql";

export function decryptDataSourceParams<T = DataSourceParams>(
  encrypted: string
): T {
  return JSON.parse(AES.decrypt(encrypted, ENCRYPTION_KEY).toString(enc.Utf8));
}

export function encryptParams(params: DataSourceParams): string {
  return AES.encrypt(JSON.stringify(params), ENCRYPTION_KEY).toString();
}

export function getNonSensitiveParams(integration: SourceIntegrationInterface) {
  const ret = { ...integration.params };
  integration.getSensitiveParamKeys().forEach((k) => {
    if (ret[k]) {
      ret[k] = "";
    }
  });
  return ret;
}

export function mergeParams(
  integration: SourceIntegrationInterface,
  newParams: Partial<DataSourceParams>
) {
  const secretKeys = integration.getSensitiveParamKeys();
  Object.keys(newParams).forEach((k: keyof DataSourceParams) => {
    // If a secret value is left empty, keep the original value
    if (secretKeys.includes(k) && !newParams[k]) return;
    integration.params[k] = newParams[k];
  });
}

export function getSourceIntegrationObject(datasource: DataSourceInterface) {
  const { type, params, settings } = datasource;

  let obj: SourceIntegrationInterface;
  if (type === "athena") {
    obj = new Athena(params, settings);
  } else if (type === "redshift") {
    obj = new Redshift(params, settings);
  } else if (type === "google_analytics") {
    obj = new GoogleAnalytics(params, settings);
  } else if (type === "snowflake") {
    obj = new Snowflake(params, settings);
  } else if (type === "postgres") {
    obj = new Postgres(params, settings);
  } else if (type === "mysql") {
    obj = new Mysql(params, settings);
  } else if (type === "bigquery") {
    obj = new BigQuery(params, settings);
  } else if (type === "clickhouse") {
    obj = new ClickHouse(params, settings);
  } else if (type === "mixpanel") {
    obj = new Mixpanel(params, settings);
  } else if (type === "presto") {
    obj = new Presto(params, settings);
  } else {
    throw new Error("Unknown data source type: " + type);
  }

  obj.organization = datasource.organization;
  obj.datasource = datasource.id;

  return obj;
}

export async function testDataSourceConnection(
  datasource: DataSourceInterface
) {
  const integration = getSourceIntegrationObject(datasource);
  await integration.testConnection();
}

interface DataSourceConnection<T> {
  conn: Promise<T>;
  destroy?: (conn: T) => void;
  expires: number;
  lastQuery: number;
}

// eslint-disable-next-line
const connPool: Map<string, DataSourceConnection<any>> = new Map();

function removeExpiredConnections() {
  const now = Date.now();
  connPool.forEach((obj, key) => {
    if (obj.expires <= now) {
      //console.log("Removing expired connection from pool", key);
      connPool.delete(key);
      if (obj.destroy) obj.destroy(obj.conn);
    }
  });
}

export function getPooledConnection<T>(
  id: string,
  create: () => Promise<T>,
  expires: number = 15,
  destroy?: (conn: T) => void
): Promise<T> {
  removeExpiredConnections();

  let obj = connPool.get(id) as DataSourceConnection<T> | undefined;
  if (obj) {
    //console.log("Re-using connection from pool", id);
    obj.lastQuery = Date.now();
    return obj.conn;
  }

  //console.log("Creating new connection in pool", id);
  obj = {
    conn: create(),
    expires: Date.now() + 1000 * 60 * expires,
    destroy,
    lastQuery: Date.now(),
  };
  connPool.set(id, obj);
  return obj.conn;
}
