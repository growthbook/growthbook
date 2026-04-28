/**
 * Delegates managed ClickHouse operations to central-license-server
 * (see managed-clickhouse/* routes there).
 */
import { z } from "zod";
import type { AIPromptType } from "shared/ai";
import type { MaterializedColumn } from "shared/types/datasource";
import type { DailyUsage, SDKAttribute } from "shared/types/organization";
import {
  dailyUsageForOrgResponseValidator,
  factTableColumnTypeValidator,
} from "shared/validators";
import type { RequestInit, Response } from "node-fetch";
import { LICENSE_SERVER_URL } from "back-end/src/enterprise/licenseUtil";
import { logger } from "back-end/src/util/logger";
import { fetch } from "back-end/src/util/http.util";
import { CLOUD_SECRET, IS_CLOUD } from "back-end/src/util/secrets";

const MAX_SENTRY_RESPONSE_BODY_LENGTH = 16_000;
/** Long cap so outbound requests cannot hang indefinitely (e.g. black-holed TCP). */
const MANAGED_CLICKHOUSE_FETCH_TIMEOUT_MS = 60 * 60 * 1000;

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

/**
 * Error thrown for caller-fixable 4xx responses from the license server (e.g.
 * an attribute name that can't be materialized as a ClickHouse column). The
 * `message` is taken straight from the server's `errorMessage` field so it's
 * safe to surface to the user.
 */
export class ManagedClickhouseClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ManagedClickhouseClientError";
    this.status = status;
  }
}

async function postManagedClickhouse(
  path: string,
  body: unknown,
  { propagateClientErrors }: { propagateClientErrors?: boolean } = {},
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

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, MANAGED_CLICKHOUSE_FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CLOUD_SECRET}`,
      },
      body: JSON.stringify(body),
      signal: abortController.signal as RequestInit["signal"],
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const timedOut = error.name === "AbortError";
    logger.error(
      {
        err: error,
        license_server_managed_clickhouse_path: path,
        license_server_managed_clickhouse_url: url,
        license_server_managed_clickhouse_timed_out: timedOut,
      },
      timedOut
        ? "License server managed ClickHouse request timed out before HTTP response"
        : "License server managed ClickHouse request failed before HTTP response",
    );
    throw new Error(
      timedOut
        ? "The managed warehouse service did not respond in time. Please try again in a few minutes. If the problem continues, contact support."
        : "We couldn't reach the managed warehouse service. Please try again in a few minutes. If the problem continues, contact support.",
    );
  } finally {
    clearTimeout(timeoutId);
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

    // 423 Locked is a transient "another change is in flight" — surface a
    // retry-friendly message regardless of the propagateClientErrors flag.
    if (res.status === 423) {
      throw new Error(
        "Another change to your managed warehouse is in progress. Please try again in a moment.",
      );
    }

    if (propagateClientErrors && res.status >= 400 && res.status < 500) {
      throw new ManagedClickhouseClientError(detail, res.status);
    }

    throw new Error(
      "The managed warehouse service returned an error. Please try again or contact support if this continues.",
    );
  }

  return res;
}

async function postManagedClickhouseJson<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const res = await postManagedClickhouse(path, body);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      "The managed warehouse service returned invalid JSON. Please try again or contact support if this continues.",
    );
  }
}

export async function dangerousRecreateClickhouseTables(
  orgId: string,
): Promise<void> {
  await postManagedClickhouse("recreate-tables", { orgId });
}

export async function deleteClickhouseUser(orgId: string): Promise<void> {
  await postManagedClickhouse("delete", { orgId });
}

export async function addCloudSDKMapping(
  key: string,
  organization: string,
): Promise<void> {
  await postManagedClickhouse("sdk-key-mapping", {
    key,
    organization,
  });
}

export async function migrateOverageEventsForOrgId(
  orgId: string,
): Promise<void> {
  await postManagedClickhouse("migrate-overage", { orgId });
}

export async function updateMaterializedColumnsInClickhouse({
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

export async function logCloudAIUsage({
  organization,
  type,
  model,
  temperature,
  numPromptTokensUsed,
  numCompletionTokensUsed,
  usedDefaultPrompt,
}: {
  organization: string;
  type: AIPromptType;
  model: string;
  numPromptTokensUsed?: number;
  numCompletionTokensUsed?: number;
  temperature?: number;
  usedDefaultPrompt: boolean;
}): Promise<void> {
  if (!IS_CLOUD) {
    return;
  }

  try {
    await postManagedClickhouse("log-ai-usage", {
      organization,
      type,
      model,
      temperature,
      numPromptTokensUsed,
      numCompletionTokensUsed,
      usedDefaultPrompt,
    });
  } catch (e) {
    logger.error(e, "Failed to log AI usage to Clickhouse");
  }
}

export async function getDailyUsageForOrg(
  orgId: string,
  start: Date,
  end: Date,
): Promise<DailyUsage[]> {
  const json = await postManagedClickhouseJson("daily-usage-for-org", {
    orgId,
    start: start.toISOString(),
    end: end.toISOString(),
  });
  const parsed = dailyUsageForOrgResponseValidator.safeParse(json);
  if (!parsed.success) {
    logger.error(
      { zodError: parsed.error.flatten() },
      "Unexpected response shape from daily-usage-for-org endpoint",
    );
    throw new Error(
      "Unexpected response shape from daily-usage-for-org endpoint",
    );
  }
  return parsed.data.days;
}

export type ManagedWarehouseUserIdType = {
  userIdType: string;
  description: string;
};

export type ManagedWarehouseExposureQuery = {
  id: string;
  dimensions: string[];
  name: string;
  userIdType: string;
  query: string;
};

// Wire-format schemas for validating responses from the license server.
// LS and GB are owned by the same team but the schemas guard against silent
// drift if a field is renamed on one side and not the other.
const sdkAttributeWireSchema = z.looseObject({
  property: z.string(),
  datatype: z.enum([
    "boolean",
    "string",
    "number",
    "secureString",
    "enum",
    "string[]",
    "number[]",
    "secureString[]",
  ]),
});

const materializedColumnWireSchema = z.looseObject({
  columnName: z.string(),
  sourceField: z.string(),
  datatype: factTableColumnTypeValidator,
  type: z.enum(["", "identifier", "dimension"]).optional(),
  arrayElementType: z.enum(["string", "number"]).optional(),
});

const prepareAttributeMigrationResponseSchema = z.object({
  attributeBackfill: z.array(sdkAttributeWireSchema),
  firstTimeMigration: z.boolean(),
});

const syncAttributesResponseSchema = z.object({
  syncedMaterializedColumns: z.array(materializedColumnWireSchema),
  shouldRegenerateDerivedSettings: z.boolean(),
  userIdTypes: z.array(
    z.object({ userIdType: z.string(), description: z.string() }),
  ),
  exposureQueries: z.array(
    z.object({
      id: z.string(),
      dimensions: z.array(z.string()),
      name: z.string(),
      userIdType: z.string(),
      query: z.string(),
    }),
  ),
});

async function parseLicenseServerResponse<T extends z.ZodTypeAny>(
  res: Response,
  schema: T,
  path: string,
): Promise<z.infer<T>> {
  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    logger.error(
      {
        license_server_managed_clickhouse_path: path,
        zod_errors: parsed.error.issues,
      },
      `License server managed ClickHouse response failed schema validation: ${path}`,
    );
    throw new Error(
      "The managed warehouse service returned an unexpected response. Please try again or contact support if this continues.",
    );
  }
  return parsed.data;
}

export type PrepareManagedWarehouseAttributeMigrationResult = {
  /** SDKAttributes derived from legacy materializedColumns that the caller
   *  must merge into org.settings.attributeSchema before calling sync. Empty
   *  on any datasource that has already been synced. */
  attributeBackfill: SDKAttribute[];
  firstTimeMigration: boolean;
};

/**
 * Read-only: plan the one-time legacy-column → attributeSchema backfill for
 * the org's managed warehouse. The caller must persist the returned backfill
 * (alongside the user's edit) to `org.settings.attributeSchema` before
 * calling `syncManagedWarehouseAttributesViaLicenseServer`, so a sync
 * failure can be rolled back without stranding backfilled attributes
 * outside of the org.
 */
export async function prepareManagedWarehouseAttributeMigrationViaLicenseServer({
  orgId,
  currentAttributeSchema,
}: {
  orgId: string;
  currentAttributeSchema: SDKAttribute[];
}): Promise<PrepareManagedWarehouseAttributeMigrationResult> {
  const res = await postManagedClickhouse("prepare-attribute-migration", {
    orgId,
    currentAttributeSchema,
  });
  return await parseLicenseServerResponse(
    res,
    prepareAttributeMigrationResponseSchema,
    "prepare-attribute-migration",
  );
}

export type SyncManagedWarehouseAttributesResult = {
  syncedMaterializedColumns: MaterializedColumn[];
  shouldRegenerateDerivedSettings: boolean;
  userIdTypes: ManagedWarehouseUserIdType[];
  exposureQueries: ManagedWarehouseExposureQuery[];
};

/**
 * Run the attribute-driven managed warehouse sync on the license server.
 * Caller must have already merged any migration backfill (from
 * `prepareManagedWarehouseAttributeMigrationViaLicenseServer`) into both
 * `attributeSchema` and `previousAttributeSchema`, and persisted
 * `attributeSchema` to `org.settings.attributeSchema`.
 *
 * Throws `ManagedClickhouseClientError` for caller-fixable validation
 * failures (e.g. an attribute name that can't be a ClickHouse column) so the
 * API layer can surface them as 400s.
 */
export async function syncManagedWarehouseAttributesViaLicenseServer({
  orgId,
  attributeSchema,
  previousAttributeSchema,
  renames,
  skipNameValidation,
}: {
  orgId: string;
  attributeSchema: SDKAttribute[];
  previousAttributeSchema: SDKAttribute[];
  renames?: { from: string; to: string }[];
  skipNameValidation?: boolean;
}): Promise<SyncManagedWarehouseAttributesResult> {
  const res = await postManagedClickhouse(
    "sync-attributes",
    {
      orgId,
      attributeSchema,
      previousAttributeSchema,
      renames,
      skipNameValidation,
    },
    { propagateClientErrors: true },
  );
  return parseLicenseServerResponse(
    res,
    syncAttributesResponseSchema,
    "sync-attributes",
  );
}
