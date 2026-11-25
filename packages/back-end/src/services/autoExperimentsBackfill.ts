import type { ObjectId } from "mongodb";
import { hasCustomJs, isCrossOriginRedirect } from "shared/util";
import type { AutoExperimentFeature } from "shared/types/organization";
import { getCollection } from "back-end/src/util/mongo.util";

type Settings = Record<AutoExperimentFeature, boolean>;

type Owner = {
  id: string;
  archived?: boolean;
  status?: string;
  excludeFromPayload?: boolean;
  releasedVariationId?: string;
};

// Running, or stopped with a temporary rollout that keeps a variation live. A
// draft is out: starting it asks to enable the feature, and many were added
// once and never launched. A contextual bandit has no temporary rollout.
const isServing = (owner: Owner) =>
  !owner.archived &&
  (owner.status === "running" ||
    (owner.status === "stopped" &&
      !owner.excludeFromPayload &&
      !!owner.releasedVariationId));

// The `ids` that belong to an experiment or contextual bandit that exists and
// is serving.
async function getServingIds(
  collection: "experiments" | "contextualbandits",
  organization: string,
  ids: (string | undefined)[],
): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (!wanted.length) return new Set();
  const owners = await getCollection<Owner>(collection)
    .find(
      { organization, id: { $in: wanted } },
      {
        projection: {
          id: 1,
          archived: 1,
          status: 1,
          excludeFromPayload: 1,
          releasedVariationId: 1,
        },
      },
    )
    .toArray();
  return new Set(owners.filter(isServing).map((o) => o.id));
}

// A changeset or redirect left behind by a deleted experiment, or held by one
// that isn't serving it, is not use.
async function getUsage(organization: string): Promise<Settings> {
  const [changesets, redirects] = await Promise.all([
    getCollection<{
      experiment?: string;
      contextualBandit?: string;
      visualChanges?: { js?: string }[];
    }>("visualchangesets")
      .find(
        { organization },
        {
          projection: {
            experiment: 1,
            contextualBandit: 1,
            "visualChanges.js": 1,
          },
        },
      )
      .toArray(),
    getCollection<{
      experiment?: string;
      urlPattern: string;
      destinationURLs: { url: string }[];
    }>("urlredirects")
      .find(
        { organization },
        { projection: { experiment: 1, urlPattern: 1, destinationURLs: 1 } },
      )
      .toArray(),
  ]);
  const [experiments, bandits] = await Promise.all([
    getServingIds(
      "experiments",
      organization,
      [...changesets, ...redirects].map((d) => d.experiment),
    ),
    getServingIds(
      "contextualbandits",
      organization,
      changesets.map((c) => c.contextualBandit),
    ),
  ]);
  const liveChangesets = changesets.filter(
    (c) =>
      experiments.has(c.experiment ?? "") ||
      bandits.has(c.contextualBandit ?? ""),
  );
  const liveRedirects = redirects.filter((r) =>
    experiments.has(r.experiment ?? ""),
  );
  return {
    visualEditor: liveChangesets.length > 0,
    urlRedirects: liveRedirects.length > 0,
    customJs: liveChangesets.some((c) => hasCustomJs(c.visualChanges ?? [])),
    crossOriginRedirects: liveRedirects.some((r) =>
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
