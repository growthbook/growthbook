import { listEnvironmentsValidator } from "shared/validators";
import { isProductionEnvironment } from "shared/util";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const listEnvironments = createApiRequestHandler(
  listEnvironmentsValidator,
)(async (req) => {
  const environments = (req.context.org.settings?.environments || []).filter(
    (environment) =>
      req.context.permissions.canReadMultiProjectResource(environment.projects),
  );

  return {
    environments: environments.map((env) => {
      const {
        id,
        description = "",
        toggleOnList = false,
        defaultState = false,
        projects = [],
      } = env;
      return {
        id,
        projects,
        description,
        defaultState,
        toggleOnList,
        isProduction: isProductionEnvironment(env),
      };
    }),
  };
});
