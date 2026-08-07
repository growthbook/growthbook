import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "components/Settings/DataSources.tsx",
  "pages/fact-tables/index.tsx",
  "pages/approval-requests.tsx",
  "components/FactTables/ColumnList.tsx",
  "components/FactTables/FactMetricList.tsx",
  "pages/dimensions/index.tsx",
  "components/SavedQueries/SavedQueriesList.tsx",
  "pages/product-analytics/dashboards/index.tsx",
  "components/GetStarted/NeedingAttention.tsx",
  "components/Archetype/SimulateFeatureValues.tsx",
  "pages/attributes.tsx",
  "components/Archetype/ArchetypeList.tsx",
  "components/Features/SDKConnections/SDKConnectionsList.tsx",
  "components/Share/ShareModal.tsx",
];
const nativeTableTag = /<\/?(?:table|thead|tbody|tr|th|td)\b/;
const tableImport = /from\s+["']@\/ui\/Table["']/;
const failures = [];

for (const target of targets) {
  const source = readFileSync(resolve(packageRoot, target), "utf8");

  if (nativeTableTag.test(source)) {
    failures.push(`${target}: contains a native table tag`);
  }
  if (!tableImport.test(source)) {
    failures.push(`${target}: does not import @/ui/Table`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Verified ${targets.length} Table migration targets.\n`);
}
