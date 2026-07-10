import { getCollection } from "back-end/src/util/mongo.util";

// This list must mirror the sources read by `getDefinitions` in
// back-end/src/routers/organizations/organizations.controller.ts. If that
// handler starts (or stops) reading from a collection, add/remove it here
// too — otherwise the ETag won't change when that source does, and clients
// can get served a stale 304 for data they don't have yet.
//
// Every collection here must set `dateUpdated` on every write (create,
// update, and any array/subfield mutation), so the most recent one can be
// found via an indexed query on `organization` without reading/transforming
// full documents. `tags` is a single upserted doc per org (see TagModel.ts)
// rather than one doc per tag — a document count would never change after
// the first write, so it relies on `dateUpdated` too, same as the rest.
const DATE_UPDATED_COLLECTIONS = [
  "metrics",
  "datasources",
  "dimensions",
  "segments",
  "metricgroups",
  "tags",
  "savedgroups",
  "constants",
  "customfields",
  "projects",
  "facttables",
  "factmetrics",
  "decisioncriteria",
  "webhooksecrets",
] as const;

async function getMaxDateUpdated(
  collectionName: string,
  organization: string,
): Promise<number> {
  const doc = await getCollection<{ organization: string; dateUpdated?: Date }>(
    collectionName,
  ).findOne(
    { organization },
    { projection: { dateUpdated: 1, _id: 0 }, sort: { dateUpdated: -1 } },
  );
  return doc?.dateUpdated ? new Date(doc.dateUpdated).getTime() : 0;
}

/**
 * Cheap, indexed fingerprint of everything the `/organization/definitions`
 * endpoint reads. Lets the endpoint short-circuit its expensive reads,
 * transforms, and serialization when the client's cached copy is still current.
 */
export async function getDefinitionsVersion(
  organization: string,
): Promise<string> {
  const parts = await Promise.all(
    DATE_UPDATED_COLLECTIONS.map((name) =>
      getMaxDateUpdated(name, organization),
    ),
  );

  return `"${parts.join("-")}"`;
}
