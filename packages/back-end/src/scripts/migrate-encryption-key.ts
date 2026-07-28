// Must be first: sets env (cron off, stats pool off) before any imported module
// reads it at load time.
import "./migrate-encryption-key-env";
// We need to import the aliases here to make the imports work.
// eslint-disable-next-line no-restricted-imports
import "../init/aliases";
import { AES, enc } from "crypto-js";
import {
  updateDataSource,
  _dangerousGetAllDatasources,
} from "back-end/src/models/DataSourceModel";
import { usingFileConfig } from "back-end/src/init/config";
import { ENCRYPTION_KEY, IS_CLOUD } from "back-end/src/util/secrets";
import { init } from "back-end/src/init";
import { encryptParams } from "back-end/src/services/datasource";
import { encryptAIKey } from "back-end/src/services/aiCredentials";
import { getCollection } from "back-end/src/util/mongo.util";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

const [oldEncryptionKey] = process.argv.slice(2);
if (IS_CLOUD) {
  console.error("Cannot migrate encryption keys on Cloud");
  process.exit(1);
}

if (oldEncryptionKey === ENCRYPTION_KEY) {
  console.error(
    "============\n== ERROR: == Please specify the previous encryption key, not the current one\n============\n",
  );
  process.exit(1);
}

async function run() {
  // Initialize the mongo connection, etc.
  await init();
  if (usingFileConfig()) {
    console.error(
      "============\n== ERROR: == Cannot migrate encryption keys when using config.yml\n============\n",
    );
    process.exit(1);
  }

  // Loop through all data sources in Mongo
  const allDatasources = await _dangerousGetAllDatasources();
  for (let i = 0; i < allDatasources.length; i++) {
    const ds = allDatasources[i];
    const context = await getContextForAgendaJobByOrgId(ds.organization);
    const params = ds.params;
    if (!params) continue;

    // Try to decrypt and parse using the old key
    try {
      const parsed = JSON.parse(
        AES.decrypt(params, oldEncryptionKey || "dev").toString(enc.Utf8),
      );
      console.log(
        `- Decrypted '${ds.name}' (${ds.id}), re-encrypting with new key and saving...`,
      );
      // Update the data source
      await updateDataSource(context, ds, {
        params: encryptParams(parsed),
      });
    } catch (e) {
      console.log(`- Could not decrypt '${ds.name}' (${ds.id}), skipping`);
    }
  }

  // Loop through all org-level AI provider keys. These are written through
  // BaseModel, but re-encryption is a raw field rewrite with no permission or
  // audit-log meaning, so go straight at the collection instead of building a
  // context per org.
  const aiCredentials = getCollection("aicredentials");
  const allAICredentials = await aiCredentials.find({}).toArray();
  for (const credential of allAICredentials) {
    const { organization, provider, encryptedKey } = credential;
    if (typeof encryptedKey !== "string" || !encryptedKey) continue;

    // AES.decrypt with the wrong key returns an empty string rather than
    // throwing, so check the value, not just the absence of an exception.
    const decrypted = AES.decrypt(
      encryptedKey,
      oldEncryptionKey || "dev",
    ).toString(enc.Utf8);
    if (!decrypted) {
      console.log(
        `- Could not decrypt the ${provider} AI key for organization ${organization}, skipping`,
      );
      continue;
    }

    console.log(
      `- Decrypted the ${provider} AI key for organization ${organization}, re-encrypting with new key and saving...`,
    );
    await aiCredentials.updateOne(
      { organization, provider },
      {
        $set: {
          encryptedKey: encryptAIKey(decrypted),
          dateUpdated: new Date(),
        },
      },
    );
  }
}
run()
  .then(() => {
    console.log("Done!");
  })
  .catch((e) => {
    console.error(e);
  })
  .finally(() => {
    process.exit(0);
  });
