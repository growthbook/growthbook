import { SqlDialect } from "shared/types/sql";
import { QueryResponse } from "shared/types/integrations";
import { PostgresConnectionParams } from "shared/types/integrations/postgres";
import { AdobeExperiencePlatformQueryServiceConnectionParams } from "shared/types/integrations/adobe-experience-platform-query-service";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { runPostgresQuery } from "back-end/src/services/postgres";
import SqlIntegration from "./SqlIntegration";
import { adobeEpDialect } from "./dialects/adobeEp";

export function toPostgresConnection(
  p: AdobeExperiencePlatformQueryServiceConnectionParams,
): PostgresConnectionParams {
  return {
    host: p.host,
    port: p.port,
    database: p.database,
    user: p.username,
    password: `${p.technicalAccountId}:${p.credential}`,
    // TLS is required on both port 80 and 5432; sslmode=disable is rejected.
    ssl: true,
    defaultSchema: "",
  };
}

export default class AdobeEpQueryService extends SqlIntegration {
  params!: AdobeExperiencePlatformQueryServiceConnectionParams;
  requiresDatabase = false;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<AdobeExperiencePlatformQueryServiceConnectionParams>(
        encryptedParams,
      );
  }
  getSqlDialect(): SqlDialect {
    return adobeEpDialect;
  }
  runQuery(sql: string): Promise<QueryResponse> {
    return runPostgresQuery(toPostgresConnection(this.params), sql);
  }
  // Query Service documents SHOW TABLES / psql metacommands, not information_schema.
  supportsInformationSchema(): boolean {
    return false;
  }
}
