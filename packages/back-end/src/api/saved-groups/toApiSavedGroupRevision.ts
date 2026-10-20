import { Revision } from "shared/enterprise";
import { ApiSavedGroupRevision } from "shared/validators";
import { SavedGroupInterface } from "shared/types/saved-group";
import { ApiReqContext } from "back-end/types/api";
import {
  projectRevisionSnapshots,
  revisionEnvelopeToApi,
} from "back-end/src/api/revisionApiEnvelope";

/**
 * Build the API response payload for a saved-group revision.
 *
 * Hides the raw `target.{snapshot,proposedChanges}` shape used internally and
 * instead surfaces:
 *   - `baseSavedGroup`     — the snapshot at revision-creation time, projected
 *     through `apiSavedGroupValidator`
 *   - `proposedSavedGroup` — the snapshot with `proposedChanges` applied
 *   - `proposedChanges`    — the raw JSON Patch ops (escape hatch for callers
 *     that want to inspect the deltas directly)
 *
 * Everything else is the shared revision envelope. For list endpoints use
 * `toApiSavedGroupRevisions` so the owner-email lookup is batched across every
 * revision on the page.
 */
export async function toApiSavedGroupRevision(
  revision: Revision,
  context: ApiReqContext,
): Promise<ApiSavedGroupRevision> {
  const [shaped] = await toApiSavedGroupRevisions([revision], context);
  return shaped;
}

export async function toApiSavedGroupRevisions(
  revisions: Revision[],
  context: ApiReqContext,
): Promise<ApiSavedGroupRevision[]> {
  const prepared = await projectRevisionSnapshots<
    SavedGroupInterface,
    ApiSavedGroupRevision["baseSavedGroup"]
  >(
    revisions,
    (snapshot) => context.models.savedGroups.toApiInterface(snapshot),
    context,
  );

  return prepared.map(({ revision, base, proposed, proposedChanges }) => ({
    ...revisionEnvelopeToApi(revision),
    baseSavedGroup: base,
    proposedSavedGroup: proposed,
    proposedChanges,
  }));
}
