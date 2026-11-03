import {
  DataSourceInterfaceWithParams,
  DataSourceType,
} from "shared/types/datasource";
import { SnowflakeKeyPair } from "./generateSnowflakeKeyPair";

// Warehouses whose setup instructions create a password-authenticated user.
export const PASSWORD_USER_TYPES = new Set<DataSourceType>([
  "postgres",
  "redshift",
  "mysql",
  "mssql",
]);

export function hasGeneratedPassword(
  datasource: Partial<DataSourceInterfaceWithParams>,
  initial: Partial<DataSourceInterfaceWithParams>,
): boolean {
  if (!datasource.type || !PASSWORD_USER_TYPES.has(datasource.type)) {
    return false;
  }
  const current = datasource.params as { password?: string } | undefined;
  const generated = initial.params as { password?: string } | undefined;
  // True only while the field still holds the value the page filled in;
  // the note is misleading once the user has typed their own.
  return !!generated?.password && current?.password === generated.password;
}

export function withGeneratedSnowflakeKey(
  datasource: Partial<DataSourceInterfaceWithParams>,
  keyPair: SnowflakeKeyPair | null,
): Partial<DataSourceInterfaceWithParams> {
  if (!keyPair || datasource.type !== "snowflake") return datasource;
  const params = datasource.params;
  const privateKey =
    params && "privateKey" in params && typeof params.privateKey === "string"
      ? params.privateKey
      : "";
  // Keep a file the user already chose.
  if (privateKey && privateKey !== keyPair.privateKey) return datasource;
  if (privateKey === keyPair.privateKey) return datasource;
  return {
    ...datasource,
    params: {
      ...params,
      privateKey: keyPair.privateKey,
      privateKeyPassword: "",
    },
  } as Partial<DataSourceInterfaceWithParams>;
}
