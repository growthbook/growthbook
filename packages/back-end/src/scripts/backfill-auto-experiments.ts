// Must be first: turns off cron and the stats pool before any module reads env.
import "./migrate-encryption-key-env";
// We need to import the aliases here to make the imports work.
// eslint-disable-next-line no-restricted-imports
import "../init/aliases";
import { init } from "back-end/src/init";
import { backfillAutoExperimentSettings } from "back-end/src/services/autoExperimentsBackfill";

async function run() {
  await init();
  const updated = await backfillAutoExperimentSettings();
  console.log(`Set auto experiment opt-ins on ${updated} organization(s)`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
