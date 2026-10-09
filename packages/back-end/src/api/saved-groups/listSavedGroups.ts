import { listSavedGroupsValidator } from "shared/validators";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import { addLatestUploads } from "back-end/src/services/remoteSavedGroups";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listSavedGroups = createApiRequestHandler(
  listSavedGroupsValidator,
)(async (req) => {
  // `values` arrays are unbounded, so fetch the full list without them for
  // pagination/total/read-permission filtering, then hydrate just the page.
  const allWithoutValues =
    await req.context.models.savedGroups.getAllWithoutValues();

  const { type } = req.query;
  const { filtered, returnFields } = applyPagination(
    allWithoutValues
      .filter((g) => !type || g.type === type)
      .sort((a, b) => a.id.localeCompare(b.id)),
    req.query,
  );

  const page = await req.context.models.savedGroups.getByIds(
    filtered.map((g) => g.id),
  );
  const byId = new Map(page.map((g) => [g.id, g]));

  return {
    savedGroups: await resolveOwnerEmails(
      await addLatestUploads(
        req.context,
        filtered.flatMap((g) => {
          const full = byId.get(g.id);
          return full
            ? [req.context.models.savedGroups.toApiInterface(full)]
            : [];
        }),
      ),
      req.context,
    ),
    ...returnFields,
  };
});
