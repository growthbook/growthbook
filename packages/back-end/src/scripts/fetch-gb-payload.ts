/**
 * Fetch GrowthBook's own SDK payload and bake it into the repo as the
 * back-end client's offline default, plus (optionally) regenerate the
 * AppFeatures type from the REST API.
 *
 *   pnpm --filter back-end fetch-gb-payload
 *
 * Always:
 *   - GET cdn.growthbook.io/api/features/<GB_SDK_ID_PROD>  (public endpoint)
 *   - writes src/generated/gb-default-payload.ts (sorted keys, prettier-formatted)
 *
 * When GB_API_TOKEN is set (same secret coderefs.yml uses):
 *   - GET api.growthbook.io/api/v1/features (paginated, secret key)
 *   - regenerates ../shared/types/app-features.ts from each feature's valueType
 *
 * Exits non-zero on any failure so CI surfaces it; the runtime never depends
 * on this script succeeding (the committed snapshot is always present).
 */
import fs from "fs";
import path from "path";
import { format, resolveConfig } from "prettier";
import { GB_SDK_ID_PROD } from "shared/constants";
import {
  GbFeatureListItem,
  buildAppFeaturesModule,
  buildDefaultPayloadModule,
  sanitizePayload,
} from "./gb-payload.utils";

const CDN_HOST = "https://cdn.growthbook.io";
const API_HOST = "https://api.growthbook.io";

// Flags the codebase references before they exist in the GrowthBook account.
// Remove an entry once the flag has been created (the generated type will
// then include it from the API and the type-check tripwire stays intact).
const EXTRA_APP_FEATURES: Record<string, string> = {
  // Pricing Phase 1 config flag — creation is a pending launch task (P0-3).
  "pricing-phase-1-limits": "Record<string, unknown>",
};

const PAYLOAD_OUT = "src/generated/gb-default-payload.ts";
const APP_FEATURES_OUT = "../shared/types/app-features.ts";

async function writeFormatted(relPath: string, contents: string) {
  const abs = path.resolve(process.cwd(), relPath);
  const config = (await resolveConfig(abs)) || {};
  const formatted = await format(contents, {
    ...config,
    parser: "typescript",
  });
  fs.writeFileSync(abs, formatted);

  console.log(`Wrote ${relPath} (${formatted.length} bytes)`);
}

async function fetchPayload() {
  const url = `${CDN_HOST}/api/features/${GB_SDK_ID_PROD}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Payload fetch failed: ${res.status} ${res.statusText}`);
  }
  const payload = sanitizePayload(await res.json());
  const numFeatures = Object.keys(payload.features || {}).length;

  console.log(
    `Fetched payload: ${numFeatures} features, dateUpdated ${payload.dateUpdated}`,
  );
  await writeFormatted(PAYLOAD_OUT, buildDefaultPayloadModule(payload));
}

async function regenerateAppFeatures(apiToken: string) {
  const features: GbFeatureListItem[] = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const res = await fetch(
      `${API_HOST}/api/v1/features?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    if (!res.ok) {
      throw new Error(
        `Feature list fetch failed: ${res.status} ${res.statusText}`,
      );
    }
    const data = (await res.json()) as {
      features?: GbFeatureListItem[];
      hasMore?: boolean;
    };
    features.push(...(data.features || []));
    if (!data.hasMore) break;
  }

  console.log(`Fetched ${features.length} features from the REST API`);
  await writeFormatted(
    APP_FEATURES_OUT,
    buildAppFeaturesModule(features, EXTRA_APP_FEATURES),
  );
}

async function main() {
  await fetchPayload();

  const apiToken = process.env.GB_API_TOKEN;
  if (apiToken) {
    await regenerateAppFeatures(apiToken);
  } else {
    console.log("GB_API_TOKEN not set — skipping AppFeatures type regen");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
