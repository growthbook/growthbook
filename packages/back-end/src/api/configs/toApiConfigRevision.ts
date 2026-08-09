import { Revision } from "shared/enterprise";
import { ApiConfigRevision } from "shared/validators";
import { ConfigInterface } from "shared/types/config";
import { ApiReqContext } from "back-end/types/api";
import {
  projectRevisionSnapshots,
  revisionEnvelopeToApi,
} from "back-end/src/api/revisionApiEnvelope";

// Build the API response for a config revision: hides the raw `target` shape
// and surfaces base/proposed config views + the raw patch ops. Everything
// except those two payload fields is the shared revision envelope.
export async function toApiConfigRevision(
  revision: Revision,
  context: ApiReqContext,
): Promise<ApiConfigRevision> {
  const [shaped] = await toApiConfigRevisions([revision], context);
  return shaped;
}

export async function toApiConfigRevisions(
  revisions: Revision[],
  context: ApiReqContext,
): Promise<ApiConfigRevision[]> {
  const prepared = await projectRevisionSnapshots<
    ConfigInterface,
    ApiConfigRevision["baseConfig"]
  >(
    revisions,
    (snapshot) => context.models.configs.toApiInterface(snapshot),
    context,
  );

  return prepared.map(({ revision, base, proposed, proposedChanges }) => ({
    ...revisionEnvelopeToApi(revision),
    baseConfig: base,
    proposedConfig: proposed,
    proposedChanges,
  }));
}
