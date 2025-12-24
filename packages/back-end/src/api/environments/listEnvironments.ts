import { ListEnvironmentsResponse } from "shared/types/openapi";
import { listEnvironmentsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const listEnvironments = createApiRequestHandler(
  listEnvironmentsValidator,
)(async (req): Promise<ListEnvironmentsResponse> => {
  const environments = (req.context.org.settings?.environments || []).filter(
    (environment) =>
      req.context.permissions.canReadMultiProjectResource(environment.projects),
  );

  return {
    environments: environments.map(
      ({
        id,
        description = "",
        toggleOnList = false,
        defaultState = false,
        projects = [],
      }) => ({
        id,
        projects,
        description,
        defaultState,
        toggleOnList,
      }),
    ),
  };
});
