import cloneDeep from "lodash/cloneDeep";
import { Environment } from "../../types/organization";

/**
 * util for adding an environment to the existing organization environments.
 * does not mutate the existing environments object.
 * @param env
 * @param orgEnvironments
 * @param shouldReplace
 */
export const addEnvironmentToOrganizationEnvironments = (
  env: Environment,
  orgEnvironments: Environment[],
  shouldReplace: boolean = false
): Environment[] => {
  const existingMatchingEnvIndex = orgEnvironments.findIndex(
    (e) => e.id === env.id
  );

  if (existingMatchingEnvIndex === -1) {
    return [...orgEnvironments, env];
  }

  if (shouldReplace) {
    const updatedEnvironments = cloneDeep(orgEnvironments);
    updatedEnvironments[existingMatchingEnvIndex] = env;
    return updatedEnvironments;
  }

  return orgEnvironments;
};
