#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { archiveChanges, ManagedItem, metricKey } from "./prune";
import { translate } from "./translate";
import { BulkImportPayload, DbtManifest, TranslateWarning } from "./types";

const HELP = `Usage: growthbook-dbt sync --datasource <ds_id> [options]

Translates the semantic models and metrics in a dbt manifest into GrowthBook
Fact Tables and Fact Metrics and upserts them through the bulk import API.

Options:
  --manifest <path>     dbt manifest (default: target/manifest.json)
  --datasource <id>     GrowthBook Data Source id (required)
  --api-host <url>      default: $GROWTHBOOK_API_HOST or https://api.growthbook.io
  --api-key <key>       default: $GROWTHBOOK_API_KEY
  --entities <map>      dbt entity -> identifier type, e.g. customer=user_id,visitor=anonymous_id
  --select <list>       only sync these metrics/models (name globs or tag:<tag>)
  --exclude <list>      never sync these metrics/models (name globs or tag:<tag>)
  --dry-run             validate against the API without writing (with --prune, lists what would be archived or unarchived)
  --strict              exit 1 if anything was skipped or a selector matched nothing
  --prune               archive dbt-managed Fact Tables/Metrics on the Data Source that are no longer in dbt (and unarchive ones that return)
  --out <path>          write the payload to a file instead of calling the API
  -h, --help
`;

interface ApiResult {
  ok: boolean;
  status: number;
  body: unknown;
}

interface BulkImportResponse {
  factTablesAdded?: number;
  factTablesUpdated?: number;
  factMetricsAdded?: number;
  factMetricsUpdated?: number;
  errors?: { resourceType: string; id: string; message: string }[];
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null;

function printWarnings(warnings: TranslateWarning[]) {
  for (const w of warnings) {
    console.log(`[${w.level}] ${w.resource}: ${w.message}`);
  }
}

async function main() {
  const { values: args, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      manifest: { type: "string", default: "target/manifest.json" },
      datasource: { type: "string" },
      "api-host": { type: "string" },
      "api-key": { type: "string" },
      entities: { type: "string" },
      select: { type: "string" },
      exclude: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      prune: { type: "boolean", default: false },
      out: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (args.help || positionals[0] !== "sync" || !args.datasource) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }

  const host = (
    args["api-host"] ??
    process.env.GROWTHBOOK_API_HOST ??
    "https://api.growthbook.io"
  ).replace(/\/$/, "");
  const apiKey = args["api-key"] ?? process.env.GROWTHBOOK_API_KEY;
  if (!apiKey && !args.out) {
    throw new Error("An API key is required (--api-key or GROWTHBOOK_API_KEY)");
  }
  // A selected subset isn't the full picture of dbt, so pruning against it
  // would archive everything outside the selection.
  if (args.prune && (args.select || args.exclude)) {
    throw new Error("--prune cannot be combined with --select or --exclude");
  }

  const request = async (
    path: string,
    init?: RequestInit,
  ): Promise<ApiResult> => {
    const res = await fetch(`${host}/api/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const body: unknown = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  };
  const apiError = (what: string, r: ApiResult) =>
    new Error(
      `${what} failed (${r.status}): ${
        isRecord(r.body) && typeof r.body.message === "string"
          ? r.body.message
          : JSON.stringify(r.body)
      }`,
    );
  // A key that requires confirmation holds writes: they answer 202 and run
  // only once a person confirms them, so wait for the request's real outcome.
  const api = async (path: string, init?: RequestInit): Promise<ApiResult> => {
    const r = await request(path, init);
    let c =
      r.status === 202 && isRecord(r.body) && isRecord(r.body.confirmation)
        ? r.body.confirmation
        : null;
    if (!c) return r;
    console.log(`Waiting for a person to confirm this in GrowthBook: ${c.url}`);
    while (c.status === "pending" || c.status === "running") {
      const p = await request(`/confirmations/${c.id}?wait=30`);
      if (!p.ok || !isRecord(p.body) || !isRecord(p.body.confirmation)) {
        throw apiError("Waiting for confirmation", p);
      }
      c = p.body.confirmation;
    }
    const res = c.response;
    if (c.status === "completed" && isRecord(res)) {
      const status = Number(res.status);
      return { ok: status >= 200 && status < 300, status, body: res.body };
    }
    throw new Error(
      `Nothing was written: confirmation ${c.id} is ${c.status}${c.note ? ` (${c.note})` : ""}`,
    );
  };

  const list = (s?: string) =>
    s
      ?.split(",")
      .map((x) => x.trim())
      .filter((x) => x);
  const entities = Object.fromEntries(
    (list(args.entities) ?? []).map((pair) => {
      const [from, to] = pair.split("=").map((s) => s.trim());
      if (!from || !to) throw new Error(`Invalid --entities entry "${pair}"`);
      return [from, to];
    }),
  );

  let idTypes: string[] | undefined;
  if (apiKey) {
    const r = await api(`/data-sources/${args.datasource}`);
    if (!r.ok) throw apiError("Fetching the Data Source", r);
    const ds =
      isRecord(r.body) && isRecord(r.body.dataSource) ? r.body.dataSource : {};
    idTypes = (Array.isArray(ds.identifierTypes) ? ds.identifierTypes : [])
      .map((t: unknown) => (isRecord(t) ? t.id : null))
      .filter((id): id is string => typeof id === "string");
  }

  const manifest: unknown = JSON.parse(readFileSync(args.manifest, "utf8"));
  // Any other JSON (package.json, semantic_manifest.json) translates to an
  // empty payload, which --prune would read as everything leaving dbt.
  const schema =
    isRecord(manifest) && isRecord(manifest.metadata)
      ? manifest.metadata.dbt_schema_version
      : null;
  if (
    !isRecord(manifest) ||
    !isRecord(manifest.nodes) ||
    typeof schema !== "string" ||
    !schema.includes("/manifest/")
  ) {
    throw new Error(
      `${args.manifest} is not a dbt manifest.json (run dbt parse to write target/manifest.json)`,
    );
  }
  const { payload, warnings } = translate(manifest as DbtManifest, {
    datasource: args.datasource,
    entities,
    idTypes,
    select: list(args.select),
    exclude: list(args.exclude),
  });
  printWarnings(warnings);
  console.log(
    `Translated ${payload.factTables.length} fact table(s) and ${payload.factMetrics.length} metric(s)`,
  );
  const skipped = warnings.filter((w) => w.level === "skipped").length;
  const unmatched = warnings.filter((w) => w.resource.startsWith("--")).length;
  if (args.strict && (skipped || unmatched)) {
    throw new Error(
      `${skipped} resource(s) were skipped and ${unmatched} selector(s) matched nothing (--strict)`,
    );
  }

  if (args.out) {
    writeFileSync(args.out, JSON.stringify(payload, null, 2) + "\n");
    console.log(`Wrote ${args.out}`);
    return;
  }

  // A skipped table drops every metric on it, which prune would read as removed from dbt.
  const skippedTables = warnings.filter(
    (w) => w.level === "skipped" && w.resource.startsWith("fact table "),
  );
  if (args.prune && skippedTables.length) {
    throw new Error(
      `--prune refused: ${skippedTables.length} fact table(s) were skipped, so their metrics would be archived while still defined in dbt. Fix the skips above (often --entities) and run again.`,
    );
  }

  const bulk = async (dryRun: boolean) => {
    const r = await api("/bulk-import/facts", {
      method: "POST",
      body: JSON.stringify({ ...payload, dryRun }),
    });
    if (!r.ok && JSON.stringify(r.body).includes("defaultManagedBy")) {
      throw new Error(
        "This GrowthBook server does not support dbt-managed resources yet. Upgrade it to sync from dbt.",
      );
    }
    const body: BulkImportResponse = isRecord(r.body) ? r.body : {};
    for (const e of body.errors ?? []) {
      console.log(`[error] ${e.resourceType} ${e.id}: ${e.message}`);
    }
    if (!r.ok || body.errors?.length) {
      throw apiError(dryRun ? "Validation" : "Import", r);
    }
    return body;
  };
  await bulk(true);
  console.log("Validation passed");
  if (args["dry-run"]) {
    if (args.prune) await prune(api, apiError, args.datasource, payload, true);
    return;
  }
  const res = await bulk(false);
  console.log(
    `Fact tables: ${res.factTablesAdded ?? 0} added, ${res.factTablesUpdated ?? 0} updated. ` +
      `Metrics: ${res.factMetricsAdded ?? 0} added, ${res.factMetricsUpdated ?? 0} updated.`,
  );

  if (args.prune) await prune(api, apiError, args.datasource, payload, false);
}

async function prune(
  api: (path: string, init?: RequestInit) => Promise<ApiResult>,
  apiError: (what: string, r: ApiResult) => Error,
  datasource: string,
  payload: BulkImportPayload,
  dryRun: boolean,
) {
  const listAll = async (path: string, key: string) => {
    const items: ManagedItem[] = [];
    let offset = 0;
    for (;;) {
      const r = await api(
        `${path}?datasourceId=${datasource}&limit=100&offset=${offset}`,
      );
      if (!r.ok || !isRecord(r.body)) throw apiError(`Listing ${key}`, r);
      const page = r.body[key];
      for (const item of Array.isArray(page) ? page : []) {
        if (isRecord(item) && typeof item.id === "string") {
          items.push({
            id: item.id,
            managedBy: typeof item.managedBy === "string" ? item.managedBy : "",
            archived: item.archived === true,
          });
        }
      }
      if (!r.body.hasMore || typeof r.body.nextOffset !== "number") break;
      offset = r.body.nextOffset;
    }
    return items;
  };
  const setArchived = async (path: string, id: string, archived: boolean) => {
    if (dryRun) {
      console.log(`Would ${archived ? "archive" : "unarchive"} ${id}`);
      return;
    }
    const r = await api(`${path}/${id}`, {
      method: "POST",
      body: JSON.stringify({ archived }),
    });
    if (!r.ok)
      throw apiError(`${archived ? "Archiving" : "Unarchiving"} ${id}`, r);
    console.log(`${archived ? "Archived" : "Unarchived"} ${id}`);
  };
  const reconcile = async (path: string, key: string, keep: Set<string>) => {
    for (const change of archiveChanges(await listAll(path, key), keep)) {
      await setArchived(path, change.id, change.archived);
    }
  };

  await reconcile(
    "/fact-metrics",
    "factMetrics",
    new Set(payload.factMetrics.map((m) => metricKey(m.id))),
  );
  await reconcile(
    "/fact-tables",
    "factTables",
    new Set(payload.factTables.map((t) => t.id)),
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
