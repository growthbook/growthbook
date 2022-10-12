import mongoInit from "./mongo";
import licenseInit from "./license";
import { queueInit } from "./queue";

let initPromise: Promise<void>;
export async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await mongoInit();
      await queueInit();
      await licenseInit();
    })();
  }
  try {
    await initPromise;
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
