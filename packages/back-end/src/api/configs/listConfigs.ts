import { listConfigsValidator } from "shared/validators";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listConfigs = createApiRequestHandler(listConfigsValidator)(async (
  req,
) => {
  // `value` can be large, so paginate over the value-omitted projection, then
  // hydrate just the page.
  const allWithoutValues =
    await req.context.models.configs.getAllWithoutValues();

  const { filtered, returnFields } = applyPagination(
    allWithoutValues.sort((a, b) => a.id.localeCompare(b.id)),
    req.query,
  );

  const page = await req.context.models.configs.getByIds(
    filtered.map((c) => c.id),
  );
  const byId = new Map(page.map((c) => [c.id, c]));

  return {
    configs: await resolveOwnerEmails(
      filtered.flatMap((c) => {
        const full = byId.get(c.id);
        return full ? [req.context.models.configs.toApiInterface(full)] : [];
      }),
      req.context,
    ),
    ...returnFields,
  };
});
