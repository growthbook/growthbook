import { Revision } from "shared/enterprise";
import { ApiConstantRevision } from "shared/validators";
import { ConstantInterface } from "shared/types/constant";
import { ApiReqContext } from "back-end/types/api";
import {
  projectRevisionSnapshots,
  revisionEnvelopeToApi,
} from "back-end/src/api/revisionApiEnvelope";

// Build the API response for a constant revision: hides the raw `target` shape
// and surfaces base/proposed constant views + the raw patch ops. Everything
// except those two payload fields is the shared revision envelope.
export async function toApiConstantRevision(
  revision: Revision,
  context: ApiReqContext,
): Promise<ApiConstantRevision> {
  const [shaped] = await toApiConstantRevisions([revision], context);
  return shaped;
}

export async function toApiConstantRevisions(
  revisions: Revision[],
  context: ApiReqContext,
): Promise<ApiConstantRevision[]> {
  const prepared = await projectRevisionSnapshots<
    ConstantInterface,
    ApiConstantRevision["baseConstant"]
  >(
    revisions,
    (snapshot) => context.models.constants.toApiInterface(snapshot),
    context,
  );

  return prepared.map(({ revision, base, proposed, proposedChanges }) => ({
    ...revisionEnvelopeToApi(revision),
    baseConstant: base,
    proposedConstant: proposed,
    proposedChanges,
  }));
}
