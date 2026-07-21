import { listSavedGroupsValidator } from "shared/validators";
import { resolveOwnerEmails } from "back-end/src/services/owner";
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

  const { filtered, returnFields } = applyPagination(
    allWithoutValues.sort((a, b) => a.id.localeCompare(b.id)),
    req.query,
  );

  const page = await req.context.models.savedGroups.getByIds(
    filtered.map((g) => g.id),
  );
  const byId = new Map(page.map((g) => [g.id, g]));

  return {
    savedGroups: await resolveOwnerEmails(
      filtered.flatMap((g) => {
        const full = byId.get(g.id);
        return full
          ? [req.context.models.savedGroups.toApiInterface(full)]
          : [];
      }),
      req.context,
    ),
    ...returnFields,
  };
});
