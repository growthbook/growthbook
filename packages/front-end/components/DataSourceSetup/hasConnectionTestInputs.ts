import { DataSourceType } from "shared/types/datasource";
import { isCloud } from "@/services/env";

function hasText(value: unknown): boolean {
  if (typeof value === "number") return !Number.isNaN(value);
  return typeof value === "string" && value.trim() !== "";
}

// Saved connections omit secrets from the browser. A blank secret is fine
// there; a new connection has to supply one.
export function hasConnectionTestInputs(
  type: DataSourceType | undefined,
  params: object | undefined,
  keepStoredSecrets: boolean,
): boolean {
  if (!type) return false;
  const fields = (params ?? {}) as Record<string, unknown>;
  const text = (key: string) => hasText(fields[key]);
  const secret = (key: string) => keepStoredSecrets || text(key);

  switch (type) {
    case "bigquery": {
      if (!isCloud() && (fields.authType ?? "json") === "auto") return true;
      return text("projectId") && text("clientEmail") && secret("privateKey");
    }
    case "snowflake": {
      const authMethod =
        (typeof fields.authMethod === "string" ? fields.authMethod : null) ??
        (keepStoredSecrets ? "password" : "key-pair");
      if (
        !text("account") ||
        !text("username") ||
        !text("database") ||
        !text("schema")
      ) {
        return false;
      }
      if (authMethod === "workload-identity") {
        return text("workloadIdentityProvider");
      }
      if (authMethod === "password") return secret("password");
      return secret("privateKey");
    }
    case "databricks": {
      if (!text("host") || !text("path")) return false;
      if ((fields.authType ?? "pat") === "oauth-m2m") {
        return text("oauthClientId") && secret("oauthClientSecret");
      }
      return secret("token");
    }
    case "postgres":
    case "redshift":
    case "vertica":
    case "mysql":
      return (
        text("host") &&
        text("port") &&
        text("database") &&
        text("user") &&
        secret("password")
      );
    case "mssql":
      return (
        text("server") &&
        text("port") &&
        text("database") &&
        text("user") &&
        secret("password")
      );
    case "clickhouse":
      return text("url") && text("port");
    case "athena": {
      if (!text("region") || !text("bucketUri")) return false;
      const authType = isCloud()
        ? "accessKey"
        : ((fields.authType as string | undefined) ?? "accessKey");
      if (authType === "auto") return true;
      if (authType === "assumeRole") {
        return (
          secret("assumeRoleARN") &&
          secret("roleSessionName") &&
          secret("externalId")
        );
      }
      return secret("accessKeyId") && secret("secretAccessKey");
    }
    case "presto": {
      if (!text("engine") || !text("host")) return false;
      const authType = (fields.authType as string | undefined) ?? "basicAuth";
      if (authType === "basicAuth") {
        return text("username") && secret("password");
      }
      if (authType === "customAuth") return secret("customAuth");
      if (authType === "kerberos") return text("kerberosServicePrincipal");
      return true;
    }
    case "mixpanel":
      return text("username") && text("projectId") && secret("secret");
    case "adobe_experience_platform_query_service":
      return (
        text("host") &&
        text("port") &&
        text("database") &&
        text("username") &&
        text("technicalAccountId") &&
        secret("credential")
      );
    case "growthbook_clickhouse": {
      throw new Error('Not implemented yet: "growthbook_clickhouse" case');
    }
    case "google_analytics": {
      throw new Error('Not implemented yet: "google_analytics" case');
    }
    default:
      return true;
  }
}
