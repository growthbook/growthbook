import { getCollection } from "back-end/src/util/mongo.util";

export type TerminalQueryStatus = "succeeded" | "failed";

/**
 * Reconcile the query cache without model hooks or changes to status, error, or
 * dateUpdated. Idempotent: the first terminal writer wins, and cleared queries
 * or deleted models never match, so late completions cannot undo cancellation.
 */
export async function updateQueryPointerStatus({
  collectionName,
  organization,
  id,
  queryId,
  status,
}: {
  collectionName: string;
  organization: string;
  id: string;
  queryId: string;
  status: TerminalQueryStatus;
}): Promise<boolean> {
  const result = await getCollection(collectionName).updateOne(
    {
      organization,
      id,
      queries: {
        $elemMatch: {
          query: queryId,
          status: { $in: ["running", "queued"] },
        },
      },
    },
    { $set: { "queries.$.status": status } },
  );
  return result.modifiedCount > 0;
}
