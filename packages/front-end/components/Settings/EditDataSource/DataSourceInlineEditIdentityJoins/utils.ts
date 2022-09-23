import isEqual from "lodash/isEqual";
import { IdentityJoinQuery } from "back-end/types/datasource";

/**
 * Given a new list of IDs, checks if they're in the existing list of identity joins
 * @param newIds
 * @param existingIdentityJoins
 */
export const isDuplicateIdentityJoin = (
  newIds: string[],
  existingIdentityJoins: IdentityJoinQuery[]
): boolean => {
  const existingElement = existingIdentityJoins.find((item) => {
    return isEqual(item.ids.sort(), newIds.sort());
  });
  return !!existingElement;
};
