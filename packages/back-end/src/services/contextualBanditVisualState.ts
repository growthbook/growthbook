import { ContextualBanditInterface } from "shared/validators";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import {
  getVisibleVariations,
  isDeactivatedVariation,
} from "shared/experiments";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { activatePendingContextualBanditVariations } from "back-end/src/enterprise/services/contextualBandits";
import { refreshLinkedFeaturePayloads } from "back-end/src/services/contextualBanditChanges";
import {
  alignVisualChangesetArms,
  findVisualChangesetsByContextualBandit,
  genNewVisualChange,
} from "back-end/src/models/VisualChangesetModel";

type VisualChange = VisualChangesetInterface["visualChanges"][number];

export type VisualChangesArmDiff = {
  add: VisualChange[];
  removeVariationIds: string[];
};

export function diffVisualChangesWithArms(
  visualChanges: VisualChange[],
  variations: ContextualBanditInterface["variations"],
  makeEmpty: (variationId: string) => VisualChange,
): VisualChangesArmDiff | null {
  const present = new Set(visualChanges.map((vc) => vc.variation));
  const deactivatedIds = new Set(
    variations.filter(isDeactivatedVariation).map((v) => v.id),
  );
  const add = getVisibleVariations(variations)
    .filter((v) => !present.has(v.id))
    .map((v) => makeEmpty(v.id));
  const removeVariationIds = [
    ...new Set(
      visualChanges
        .map((vc) => vc.variation)
        .filter((id) => deactivatedIds.has(id)),
    ),
  ];
  return add.length || removeVariationIds.length
    ? { add, removeVariationIds }
    : null;
}

export async function onContextualBanditVisualStateChanged(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
  { changesetDeleted = false }: { changesetDeleted?: boolean } = {},
): Promise<ContextualBanditInterface> {
  let current = (await context.models.contextualBandits.getById(cb.id)) ?? cb;
  if (current.hasVisualChangesets || changesetDeleted) {
    const changesets = await findVisualChangesetsByContextualBandit(
      current.id,
      context.org.id,
    );
    for (const changeset of changesets) {
      const diff = diffVisualChangesWithArms(
        changeset.visualChanges,
        current.variations,
        (id) => genNewVisualChange({ id }),
      );
      if (!diff) continue;
      await alignVisualChangesetArms(context, changeset.id, diff);
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
