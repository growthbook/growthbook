import type { ObjectId } from "mongodb";
import { isCrossOriginRedirect } from "shared/util";
import type { AutoExperimentFeature } from "shared/types/organization";
import { getCollection } from "back-end/src/util/mongo.util";

type Settings = Record<AutoExperimentFeature, boolean>;

async function getUsage(organization: string): Promise<Settings> {
  const changesets = getCollection("visualchangesets");
  const [visual, js, redirects] = await Promise.all([
    changesets.countDocuments({ organization }, { limit: 1 }),
    changesets.countDocuments(
      { organization, "visualChanges.js": { $regex: "\\S" } },
      { limit: 1 },
    ),
    getCollection<{
      urlPattern: string;
      destinationURLs: { url: string }[];
    }>("urlredirects")
      .find(
        { organization },
        { projection: { urlPattern: 1, destinationURLs: 1 } },
      )
      .toArray(),
  ]);
  return {
    visualEditor: visual > 0,
    urlRedirects: redirects.length > 0,
    customJs: js > 0,
    crossOriginRedirects: redirects.some((r) =>
      isCrossOriginRedirect({
        urlPattern: r.urlPattern ?? "",
        destinationURLs: r.destinationURLs ?? [],
      }),
    ),
  };
}

// Narrows each SDK Connection to what its organization uses. Never widens one.
async function backfillConnections(organization: string, usage: Settings) {
  const connections = getCollection<{
    id: string;
    includeVisualExperiments?: boolean;
    includeRedirectExperiments?: boolean;
  }>("sdkconnections");
  const docs = await connections
    .find(
      { organization, allowCustomJs: { $exists: false } },
      {
        projection: {
          id: 1,
          includeVisualExperiments: 1,
          includeRedirectExperiments: 1,
        },
      },
    )
    .toArray();
  if (!docs.length) return;
  await connections.bulkWrite(
    docs.map((doc) => {
      const visual = !!doc.includeVisualExperiments && usage.visualEditor;
      const redirects = !!doc.includeRedirectExperiments && usage.urlRedirects;
      const changed =
        visual !== !!doc.includeVisualExperiments ||
        redirects !== !!doc.includeRedirectExperiments;
      return {
        updateOne: {
          // Skipped if the connection got its own value since it was read.
          filter: {
            organization,
            id: doc.id,
            allowCustomJs: { $exists: false },
          },
          update: {
            $set: {
              includeVisualExperiments: visual,
              includeRedirectExperiments: redirects,
              allowCustomJs: visual && usage.customJs,
              allowCrossOriginRedirects:
                redirects && usage.crossOriginRedirects,
              // A draft made against the old settings then conflicts on
              // publish instead of turning them back on.
              ...(changed ? { dateUpdated: new Date() } : {}),
            },
          },
        },
      };
    }),
  );
}

const PENDING = { "settings.autoExperiments": { $exists: false } };

export function countAutoExperimentBackfillPending(): Promise<number> {
  return getCollection("organizations").countDocuments(PENDING);
}

// Gives every organization that predates the opt-in explicit settings that
// match what it already uses, so nothing live changes. Safe to run again: an
// organization that has settings is skipped. With `maxMs` it stops early and
// reports what is left, so a request can run it in passes.
export async function backfillAutoExperimentSettings({
  maxMs,
}: { maxMs?: number } = {}): Promise<{ updated: number; remaining: number }> {
  const orgs = getCollection<{ id: string }>("organizations");
  const deadline = maxMs === undefined ? Infinity : Date.now() + maxMs;
  let updated = 0;
  // Walks forward by _id, so an organization that can't be updated is passed
  // over rather than read again forever.
  let after: ObjectId | null = null;
  while (Date.now() < deadline) {
    const batch: { _id: ObjectId; id: string }[] = await orgs
      .find(
        { ...PENDING, ...(after !== null ? { _id: { $gt: after } } : {}) },
        { projection: { id: 1 } },
      )
      .sort({ _id: 1 })
      .limit(100)
      .toArray();
    if (!batch.length) break;
    for (const { _id, id } of batch) {
      after = _id;
      if (!id) continue;
      const usage = await getUsage(id);
      // Connections first: a crash in between leaves the organization
      // pending, and the next run finishes it.
      await backfillConnections(id, usage);
      const res = await orgs.updateOne(
        { id, ...PENDING },
        { $set: { "settings.autoExperiments": usage } },
      );
      updated += res.modifiedCount;
      if (Date.now() >= deadline) break;
    }
  }
  return { updated, remaining: await countAutoExperimentBackfillPending() };
}
