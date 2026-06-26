import { listConstantsValidator } from "shared/validators";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listConstants = createApiRequestHandler(listConstantsValidator)(
  async (req) => {
    // `value`/`environmentValues` can be large, so paginate over the
    // value-omitted projection, then hydrate just the page.
    const allWithoutValues =
      await req.context.models.constants.getAllWithoutValues();

    const { filtered, returnFields } = applyPagination(
      allWithoutValues.sort((a, b) => a.id.localeCompare(b.id)),
      req.query,
    );

    const page = await req.context.models.constants.getByIds(
      filtered.map((c) => c.id),
    );
    const byId = new Map(page.map((c) => [c.id, c]));

    return {
      constants: await resolveOwnerEmails(
        filtered.flatMap((c) => {
          const full = byId.get(c.id);
          return full
            ? [req.context.models.constants.toApiInterface(full)]
            : [];
        }),
        req.context,
      ),
      ...returnFields,
    };
  },
);
