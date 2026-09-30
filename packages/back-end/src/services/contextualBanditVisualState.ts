import { ContextualBanditInterface } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { activatePendingContextualBanditVariations } from "back-end/src/enterprise/services/contextualBandits";
import { ContextualBanditChangesetOwner } from "back-end/src/services/changesetOwner";
import { refreshLinkedFeaturePayloads } from "back-end/src/services/contextualBanditChanges";
import {
  findVisualChangesetsByContextualBandit,
  syncVisualChangesWithVariations,
} from "back-end/src/models/VisualChangesetModel";

/**
 * The one reaction to "this CB's visual state changed": its arm set moved
 * (add / remove) or one of its changesets was written. Runs the changeset
 * sync, the pending-arm activation check and the payload refresh, in that
 * order, and returns the CB as it stands afterwards.
 */
export async function onContextualBanditVisualStateChanged(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
): Promise<ContextualBanditInterface> {
  let current = cb;
  if (current.hasVisualChangesets) {
    const owner = new ContextualBanditChangesetOwner(context, current);
    const changesets = await findVisualChangesetsByContextualBandit(
      current.id,
      context.org.id,
    );
    for (const changeset of changesets) {
      await syncVisualChangesWithVariations({
        owner,
        context,
        visualChangeset: changeset,
      });
    }
    current = owner.cb;
    ({ updated: current } = await activatePendingContextualBanditVariations(
      context,
      current,
      { bypassPermissionChecks: true },
    ));
  }
  await refreshLinkedFeaturePayloads(
    context,
    current,
    "contextualBandit.refresh",
  );
  return current;
}
