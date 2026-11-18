import type { VisualChangesetInterface } from "shared/types/visual-changeset";
import type { ApiReqContext } from "back-end/types/api";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import {
  ChangesetOwner,
  ownerNotFoundMessage,
  resolveChangesetOwner,
} from "back-end/src/services/changesetOwner";

export async function loadChangesetWithOwner(
  context: ApiReqContext,
  visualChangesetId: string,
): Promise<{ changeset: VisualChangesetInterface; owner: ChangesetOwner }> {
  const changeset = await findVisualChangesetById(
    visualChangesetId,
    context.org.id,
  );
  if (!changeset) {
    return context.throwNotFoundError("Visual changeset not found");
  }
  const owner = await resolveChangesetOwner(context, changeset);
  if (!owner) {
    return context.throwNotFoundError(ownerNotFoundMessage(changeset));
  }
  return { changeset, owner };
}
