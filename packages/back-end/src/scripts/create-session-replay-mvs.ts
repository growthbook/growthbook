// We need to import the aliases here to make the imports work.
// eslint-disable-next-line no-restricted-imports
import "../init/aliases";
import { _dangerousGetAllDatasources } from "back-end/src/models/DataSourceModel";
import { init } from "back-end/src/init";
import { createSessionReplayMVIfMissing } from "back-end/src/services/clickhouse";
import { CLICKHOUSE_SESSION_REPLAY_TABLE } from "back-end/src/util/secrets";

async function run() {
  await init();

  if (!CLICKHOUSE_SESSION_REPLAY_TABLE) {
    console.error(
      "CLICKHOUSE_SESSION_REPLAY_TABLE is not set — nothing to do.",
    );
    process.exit(1);
  }

  const allDatasources = await _dangerousGetAllDatasources();
  const clickhouseDatasources = allDatasources.filter(
    (ds) => ds.type === "growthbook_clickhouse",
  );

  console.log(
    `Found ${clickhouseDatasources.length} growthbook_clickhouse datasource(s)`,
  );

  let succeeded = 0;
  let failed = 0;

  for (const ds of clickhouseDatasources) {
    try {
      await createSessionReplayMVIfMissing(ds.organization);
      console.log(`✓  ${ds.organization}`);
      succeeded++;
    } catch (e) {
      console.error(`✗  ${ds.organization}: ${e}`);
      failed++;
    }
  }

  console.log(`\nDone — ${succeeded} succeeded, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
