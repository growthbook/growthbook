import {
  getNamespaceMembershipsValidator,
  type ApiNamespaceExperimentMember,
} from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import {
  filterAllNamespaceExperiments,
  getLastPhaseNamespaceRanges,
} from "./namespaceApiUtils";

export const getNamespaceMemberships = createApiRequestHandler(
  getNamespaceMembershipsValidator,
)(async (req) => {
  const { id } = req.params;

  const namespaces = req.context.org.settings?.namespaces ?? [];
  if (!namespaces.some((n) => n.name === id)) {
    throw new NotFoundError("Namespace not found.");
  }

  const allExperiments = await getAllExperiments(req.context);
  const members: ApiNamespaceExperimentMember[] = filterAllNamespaceExperiments(
    allExperiments,
    id,
  ).map((e) => ({
    id: e.id,
    name: e.name,
    trackingKey: e.trackingKey,
    status: e.status,
    ranges: getLastPhaseNamespaceRanges(e),
  }));

  const { filtered, returnFields } = applyPagination(members, req.query);

  return { experiments: filtered, ...returnFields };
});
