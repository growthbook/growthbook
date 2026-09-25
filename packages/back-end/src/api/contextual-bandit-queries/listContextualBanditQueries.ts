import { contextualBanditQueryEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import { toApiContextualBanditQuery } from "back-end/src/enterprise/models/ContextualBanditQueryModel";

export const listContextualBanditQueries = createApiRequestHandler(
  contextualBanditQueryEndpoints.listContextualBanditQueries,
)(async (req) => {
  const model = req.context.models.contextualBanditQueries;
  const { datasourceId } = req.query;
  const docs = datasourceId
    ? await model.getByDatasource(datasourceId)
    : await model.getAll();
  return {
    contextualBanditQueries: await resolveOwnerEmails(
      docs.map(toApiContextualBanditQuery),
      req.context,
    ),
  };
});
