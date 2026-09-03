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
import {
  decryptAIKey,
  encryptAIKey,
  getKeyLast4,
} from "back-end/src/services/aiCredentials";
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

// Drives the exit code: a partial rotation leaves unreadable keys behind.
let failures = 0;

function recordFailure(message: string, e?: unknown) {
  failures++;
  console.error(`- ERROR: ${message}${e ? `: ${String(e)}` : ""}`);
}

function decrypt(ciphertext: string, key: string): string {
  try {
    return AES.decrypt(ciphertext, key).toString(enc.Utf8);
  } catch {
    return "";
  }
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

    try {
      const parsed = JSON.parse(
        AES.decrypt(params, oldEncryptionKey || "dev").toString(enc.Utf8),
      );
      console.log(
        `- Decrypted '${ds.name}' (${ds.id}), re-encrypting with new key and saving...`,
      );
      await updateDataSource(context, ds, {
        params: encryptParams(parsed),
      });
    } catch (e) {
      console.log(`- Could not decrypt '${ds.name}' (${ds.id}), skipping`);
    }
  }

  // Written through BaseModel normally, but re-encryption is a raw field rewrite
  // with no permission or audit meaning, so go straight at the collection.
  const aiCredentials = getCollection("aicredentials");
  const allAICredentials = await aiCredentials.find({}).toArray();
  for (const credential of allAICredentials) {
    const { organization, provider, encryptedKey, last4 } = credential;
    if (typeof encryptedKey !== "string" || !encryptedKey) {
      recordFailure(
        `the ${provider} AI key for organization ${organization} has no ciphertext`,
      );
      continue;
    }
    if (typeof last4 !== "string" || !last4) {
      recordFailure(
        `the ${provider} AI key for organization ${organization} has no fingerprint and cannot be rotated safely`,
      );
      continue;
    }

    try {
      const currentPlaintext = decryptAIKey(encryptedKey);
      if (getKeyLast4(currentPlaintext) === last4) {
        console.log(
          `- The ${provider} AI key for organization ${organization} is already on the current key`,
        );
        continue;
      }

      const decrypted = decrypt(encryptedKey, oldEncryptionKey || "dev");
      if (getKeyLast4(decrypted) !== last4) {
        recordFailure(
          `could not decrypt the ${provider} AI key for organization ${organization} with either encryption key`,
        );
        continue;
      }

      const reEncrypted = encryptAIKey(decrypted);
      console.log(
        `- Decrypted the ${provider} AI key for organization ${organization}, re-encrypting with new key and saving...`,
      );
      // Matched on the ciphertext too, so an admin rotating this key mid-run
      // doesn't lose it. Salted, so it differs per save and acts as a version.
      const result = await aiCredentials.updateOne(
        { organization, provider, encryptedKey },
        {
          $set: {
            encryptedKey: reEncrypted,
            dateUpdated: new Date(),
          },
        },
      );
      if (result.matchedCount !== 1) {
        // Changed under us, so whatever is there now is on the current key.
        console.log(
          `- The ${provider} AI key for organization ${organization} changed while migrating, skipping`,
        );
      }
    } catch (e) {
      recordFailure(
        `could not migrate the ${provider} AI key for organization ${organization}`,
        e,
      );
    }
  }
}
run()
  .then(() => {
    if (failures > 0) {
      console.error(
        `\nDone, but ${failures} record(s) could not be re-encrypted and are still on the old key. Keep the old key and re-run after fixing the errors above.`,
      );
      process.exit(1);
    }
    console.log("Done!");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
