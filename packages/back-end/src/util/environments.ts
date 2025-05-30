import cloneDeep from "lodash/cloneDeep";
import { Environment, ReqContext } from "back-end/types/organization";

/**
 * util for adding an environment to the existing organization environments.
 * does not mutate the existing environments object.
 * @param env
 * @param orgEnvironments
 * @param shouldReplace
 */
export const addEnvironmentToOrganizationEnvironments = (
  context: ReqContext,
  env: Environment,
  orgEnvironments: Environment[],
  shouldReplace: boolean = false
): Environment[] => {
  const existingMatchingEnvIndex = orgEnvironments.findIndex(
    (e) => e.id === env.id
  );

  if (existingMatchingEnvIndex === -1) {
    if (!context.permissions.canCreateEnvironment(env)) {
      context.permissions.throwPermissionError();
    }
    return [...orgEnvironments, env];
  }

  if (shouldReplace) {
    if (
      !context.permissions.canUpdateEnvironment(
        orgEnvironments[existingMatchingEnvIndex],
        env
      )
    ) {
      context.permissions.throwPermissionError();
    }
    const updatedEnvironments = cloneDeep(orgEnvironments);
    updatedEnvironments[existingMatchingEnvIndex] = env;
    return updatedEnvironments;
  }

  return orgEnvironments;
};
