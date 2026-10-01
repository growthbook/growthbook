import { ContextualBanditInterface } from "shared/validators";
import { getVisibleVariations } from "shared/experiments";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { activatePendingContextualBanditVariations } from "back-end/src/enterprise/services/contextualBandits";
import { refreshLinkedFeaturePayloads } from "back-end/src/services/contextualBanditChanges";
import {
  findVisualChangesetsByContextualBandit,
  syncVisualChangesWithVariations,
} from "back-end/src/models/VisualChangesetModel";

export async function onContextualBanditVisualStateChanged(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
): Promise<ContextualBanditInterface> {
  let current = cb;
  if (current.hasVisualChangesets) {
    const variations = getVisibleVariations(current.variations);
    const changesets = await findVisualChangesetsByContextualBandit(
      current.id,
      context.org.id,
    );
    for (const changeset of changesets) {
      await syncVisualChangesWithVariations({
        owner: null,
        variations,
        context,
        visualChangeset: changeset,
      });
    }
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
