import cloneDeep from "lodash/cloneDeep";
import { Environment } from "shared/types/organization";
import { ReqContext } from "back-end/types/request";

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
  shouldReplace: boolean = false,
): Environment[] => {
  const existingMatchingEnvIndex = orgEnvironments.findIndex(
    (e) => e.id === env.id,
  );

  if (existingMatchingEnvIndex === -1) {
    if (!context.permissions.canCreateEnvironment(env)) {
      context.permissions.throwPermissionError();
    }
    if (!context.limits.isEnvironmentIdAllowed(env.id)) {
      context.throwPaymentRequiredError(
        `Your plan does not support custom environments. Upgrade your plan to create environments other than the defaults.`,
      );
    }
    return [...orgEnvironments, env];
  }

  if (shouldReplace) {
    if (
      !context.permissions.canUpdateEnvironment(
        orgEnvironments[existingMatchingEnvIndex],
        env,
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
