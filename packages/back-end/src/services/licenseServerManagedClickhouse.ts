/**
 * Delegates managed ClickHouse provisioning to central-license-server
 * (see managed-clickhouse/* routes there).
 */
import type {
  DataSourceParams,
  MaterializedColumn,
} from "shared/types/datasource";
import type { Response } from "node-fetch";
import { LICENSE_SERVER_URL } from "back-end/src/enterprise/licenseUtil";
import { fetch } from "back-end/src/util/http.util";

async function postManagedClickhouse(
  path: string,
  body: unknown,
): Promise<Response> {
  const cloudSecret = process.env.CLOUD_SECRET;
  if (!cloudSecret) {
    throw new Error(
      "CLOUD_SECRET must be set to use license server managed ClickHouse",
    );
  }
  const base = LICENSE_SERVER_URL.endsWith("/")
    ? LICENSE_SERVER_URL
    : `${LICENSE_SERVER_URL}/`;
  const url = `${base}managed-clickhouse/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cloudSecret}`,
    },
    body: JSON.stringify(body),
  });
  return res;
}

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as {
      errorMessage?: string;
      error?: string;
      message?: string;
    };
    return (
      j.errorMessage || j.error || j.message || text || `HTTP ${res.status}`
    );
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

export async function createClickhouseUserViaLicenseServer(
  orgId: string,
  materializedColumns: MaterializedColumn[] = [],
): Promise<DataSourceParams> {
  const res = await postManagedClickhouse("provision", {
    orgId,
    materializedColumns,
  });
  if (!res.ok) {
    throw new Error(
      `createClickhouseUserViaLicenseServer: ${await readErrorMessage(res)}`,
    );
  }
  return (await res.json()) as DataSourceParams;
}

export async function dangerousRecreateClickhouseTablesViaLicenseServer(
  orgId: string,
  materializedColumns: MaterializedColumn[] = [],
): Promise<void> {
  const res = await postManagedClickhouse("recreate-tables", {
    orgId,
    materializedColumns,
  });
  if (!res.ok) {
    throw new Error(
      `dangerousRecreateClickhouseTablesViaLicenseServer: ${await readErrorMessage(res)}`,
    );
  }
}

export async function deleteClickhouseUserViaLicenseServer(
  orgId: string,
): Promise<void> {
  const res = await postManagedClickhouse("delete", { orgId });
  if (!res.ok) {
    throw new Error(
      `deleteClickhouseUserViaLicenseServer: ${await readErrorMessage(res)}`,
    );
  }
}

export async function addCloudSDKMappingViaLicenseServer(
  key: string,
  organization: string,
): Promise<void> {
  const res = await postManagedClickhouse("sdk-key-mapping", {
    key,
    organization,
  });
  if (!res.ok) {
    throw new Error(
      `addCloudSDKMappingViaLicenseServer: ${await readErrorMessage(res)}`,
    );
  }
}

export async function migrateOverageEventsForOrgIdViaLicenseServer(
  orgId: string,
): Promise<void> {
  const res = await postManagedClickhouse("migrate-overage", { orgId });
  if (!res.ok) {
    throw new Error(
      `migrateOverageEventsForOrgIdViaLicenseServer: ${await readErrorMessage(res)}`,
    );
  }
}

export async function updateMaterializedColumnsInClickhouseViaLicenseServer({
  orgId,
  columnsToAdd,
  columnsToDelete,
  columnsToRename,
  finalColumns,
  originalColumns,
}: {
  orgId: string;
  columnsToAdd: MaterializedColumn[];
  columnsToDelete: string[];
  columnsToRename: { from: string; to: string }[];
  finalColumns: MaterializedColumn[];
  originalColumns: MaterializedColumn[];
}): Promise<void> {
  const res = await postManagedClickhouse("update-materialized-columns", {
    orgId,
    columnsToAdd,
    columnsToDelete,
    columnsToRename,
    finalColumns,
    originalColumns,
  });
  if (!res.ok) {
    throw new Error(
      `updateMaterializedColumnsInClickhouseViaLicenseServer: ${await readErrorMessage(res)}`,
    );
  }
}
