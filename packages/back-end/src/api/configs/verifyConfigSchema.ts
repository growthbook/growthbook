import { createHash } from "crypto";
import { verifyConfigSchemaValidator } from "shared/validators";
import { SchemaField } from "shared/types/feature";
import { canonicalSchemaString, diffSchemaFields } from "shared/util";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { resolveConfigSchemaSource } from "./validations";

// Stable content fingerprint of a field set — the hash of its canonical form, so
// two schemas with the same meaning (any field order, cosmetic differences)
// share a fingerprint and only a real change moves it.
function schemaFingerprint(fields: SchemaField[]): string {
  return (
    "sha256:" +
    createHash("sha256").update(canonicalSchemaString(fields)).digest("hex")
  );
}

// Read-only drift check: convert the supplied schema source and compare it to the
// config's own stored schema. Nothing is mutated. CI can branch on `inSync` (or
// the fingerprints) and read `drift` for a categorized, contract-vs-docs diff.
export const verifyConfigSchema = createApiRequestHandler(
  verifyConfigSchemaValidator,
)(async (req) => {
  // getByKey enforces read permission (returns nothing for an unreadable config).
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config with that key");
  }

  const { schema: incoming, warnings } = resolveConfigSchemaSource({
    source: req.body.schema,
  });

  const storedFields = config.schema?.fields ?? [];
  const incomingFields = incoming?.fields ?? [];

  const fingerprint = schemaFingerprint(storedFields);
  const incomingFingerprint = schemaFingerprint(incomingFields);
  const inSync = fingerprint === incomingFingerprint;

  return {
    inSync,
    fingerprint,
    incomingFingerprint,
    ...(inSync
      ? {}
      : { drift: diffSchemaFields(storedFields, incomingFields) }),
    ...(warnings.length ? { warnings } : {}),
  };
});
