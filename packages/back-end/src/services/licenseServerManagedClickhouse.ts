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
import { logger } from "back-end/src/util/logger";
import { fetch } from "back-end/src/util/http.util";
import { CLOUD_SECRET } from "back-end/src/util/secrets";

const MAX_SENTRY_RESPONSE_BODY_LENGTH = 16_000;

function errorDetailForLog(text: string, status: number): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return `HTTP ${status}`;
  }
  try {
    const j = JSON.parse(text) as {
      errorMessage?: string;
      error?: string;
      message?: string;
    };
    const candidate = j.errorMessage ?? j.error ?? j.message;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate.trim();
    }
  } catch {
    // use raw body below
  }
  return trimmed;
}

async function postManagedClickhouse(
  path: string,
  body: unknown,
): Promise<Response> {
  if (!CLOUD_SECRET) {
    throw new Error(
      "CLOUD_SECRET must be set to use license server managed ClickHouse",
    );
  }
  const base = LICENSE_SERVER_URL.endsWith("/")
    ? LICENSE_SERVER_URL
    : `${LICENSE_SERVER_URL}/`;
  const url = `${base}managed-clickhouse/${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CLOUD_SECRET}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(
      {
        err: error,
        license_server_managed_clickhouse_path: path,
        license_server_managed_clickhouse_url: url,
      },
      "License server managed ClickHouse request failed before HTTP response",
    );
    throw new Error(
      "We couldn't reach the managed warehouse service. Please try again in a few minutes. If the problem continues, contact support.",
    );
  }

  if (!res.ok) {
    const rawBody = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    const detail = errorDetailForLog(rawBody, res.status);
    const bodyForSentry =
      rawBody.length > MAX_SENTRY_RESPONSE_BODY_LENGTH
        ? `${rawBody.slice(0, MAX_SENTRY_RESPONSE_BODY_LENGTH)}\n…[truncated]`
        : rawBody;

    logger.error(
      {
        err: new Error(
          `managed-clickhouse/${path}: HTTP ${res.status} ${res.statusText || ""}`.trim(),
        ),
        license_server_managed_clickhouse_path: path,
        http_status: res.status,
        http_status_text: res.statusText,
        response_content_type: contentType,
        response_body: bodyForSentry,
        response_body_length: rawBody.length,
        license_server_error_detail: detail,
      },
      `License server managed ClickHouse HTTP error: ${path} (${res.status})`,
    );

    throw new Error(
      "The managed warehouse service returned an error. Please try again or contact support if this continues.",
    );
  }

  return res;
}

export async function createClickhouseUserViaLicenseServer(
  orgId: string,
  materializedColumns: MaterializedColumn[] = [],
): Promise<DataSourceParams> {
  const res = await postManagedClickhouse("provision", {
    orgId,
    materializedColumns,
  });
  return (await res.json()) as DataSourceParams;
}

export async function dangerousRecreateClickhouseTablesViaLicenseServer(
  orgId: string,
  materializedColumns: MaterializedColumn[] = [],
): Promise<void> {
  await postManagedClickhouse("recreate-tables", {
    orgId,
    materializedColumns,
  });
}

export async function deleteClickhouseUserViaLicenseServer(
  orgId: string,
): Promise<void> {
  await postManagedClickhouse("delete", { orgId });
}

export async function addCloudSDKMappingViaLicenseServer(
  key: string,
  organization: string,
): Promise<void> {
  await postManagedClickhouse("sdk-key-mapping", {
    key,
    organization,
  });
}

export async function migrateOverageEventsForOrgIdViaLicenseServer(
  orgId: string,
): Promise<void> {
  await postManagedClickhouse("migrate-overage", { orgId });
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
  await postManagedClickhouse("update-materialized-columns", {
    orgId,
    columnsToAdd,
    columnsToDelete,
    columnsToRename,
    finalColumns,
    originalColumns,
  });
}
