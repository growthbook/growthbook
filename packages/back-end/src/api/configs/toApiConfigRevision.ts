import { Revision } from "shared/enterprise";
import { ApiConfigRevision } from "shared/validators";
import { ConfigInterface } from "shared/types/config";
import { ApiReqContext } from "back-end/types/api";
import {
  projectRevisionSnapshots,
  revisionEnvelopeToApi,
} from "back-end/src/api/revisionApiEnvelope";

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
