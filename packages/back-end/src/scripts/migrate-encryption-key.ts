import { AES, enc } from "crypto-js";
import {
  updateDataSource,
  _dangerousGetAllDatasources,
} from "../models/DataSourceModel";
import { usingFileConfig } from "../init/config";
import { ENCRYPTION_KEY, IS_CLOUD } from "../util/secrets";
import { init } from "../init";
import { encryptParams } from "../services/datasource";

const [oldEncryptionKey] = process.argv.slice(2);
if (IS_CLOUD) {
  console.error("Cannot migrate encryption keys on Cloud");
  process.exit(1);
}

if (oldEncryptionKey === ENCRYPTION_KEY) {
  console.error(
    "============\n== ERROR: == Please specify the previous encryption key, not the current one\n============\n"
  );
  process.exit(1);
}

async function run() {
  // Initialize the mongo connection, etc.
  await init();
  if (usingFileConfig()) {
    console.error(
      "============\n== ERROR: == Cannot migrate encryption keys when using config.yml\n============\n"
    );
    process.exit(1);
  }

  // Loop through all data sources in Mongo
  const allDatasources = await _dangerousGetAllDatasources();
  for (let i = 0; i < allDatasources.length; i++) {
    const ds = allDatasources[i];
    const params = ds.params;
    if (!params) continue;

    // Try to decrypt and parse using the old key
    try {
      const parsed = JSON.parse(
        AES.decrypt(params, oldEncryptionKey || "dev").toString(enc.Utf8)
      );
      console.log(
        `- Decrypted '${ds.name}' (${ds.id}), re-encrypting with new key and saving...`
      );
      // Update the data source
      await updateDataSource(ds.id, ds.organization, {
        params: encryptParams(parsed),
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`- Could not decrypt '${ds.name}' (${ds.id}), skipping`);
    }
  }
}
run()
  .then(() => {
    // eslint-disable-next-line no-console
    console.log("Done!");
  })
  .catch((e) => {
    console.error(e);
  })
  .finally(() => {
    process.exit(0);
  });
