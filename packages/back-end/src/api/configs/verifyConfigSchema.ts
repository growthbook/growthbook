import { createHash } from "crypto";
import { verifyConfigSchemaValidator } from "shared/validators";
import { SchemaField } from "shared/types/feature";
import {
  canonicalSchemaString,
  diffSchemaFields,
  getAncestorSchemaFieldOwners,
  classifyAncestorOwnedFields,
  ancestorCollisionWarnings,
} from "shared/util";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { resolveConfigSchemaSource } from "./validations";

// Hashes the canonical form, so two equivalent schemas (any field order,
// cosmetic differences) share a fingerprint and only a real change moves it.
function schemaFingerprint(fields: SchemaField[]): string {
  return (
    "sha256:" +
    createHash("sha256").update(canonicalSchemaString(fields)).digest("hex")
  );
}

// Read-only drift check: compares the supplied schema source to the stored one;
// nothing is mutated. CI can branch on `inSync` or the fingerprints.
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

  // Pre-flight the ancestor normalization every write path runs, so a client
  // can predict which incoming fields would strip harmlessly (identical) and
  // which would make the save fail (conflicting) — and subtract inherited
  // fields from the drift's "added" set on a full-effective-schema round-trip.
  const all = await req.context.models.configs.getAllForReconcile();
  const byKey = new Map(all.map((c) => [c.key, c]));
  const { identical, conflicting } = classifyAncestorOwnedFields(
    incoming,
    getAncestorSchemaFieldOwners(config, byKey),
  );
  warnings.push(...ancestorCollisionWarnings(identical));
  const ancestorOwnedFields = [
    ...identical.map((c) => ({
      key: c.key,
      ownedBy: c.owner,
      identical: true,
    })),
    ...conflicting.map((c) => ({
      key: c.key,
      ownedBy: c.owner,
      identical: false,
    })),
  ];

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
    ...(ancestorOwnedFields.length ? { ancestorOwnedFields } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
});
