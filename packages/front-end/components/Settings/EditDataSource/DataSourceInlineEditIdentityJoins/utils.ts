import isEqual from "lodash/isEqual";
import sortBy from "lodash/sortBy";

import { IdentityJoinQuery } from "shared/types/datasource";

/**
 * Given a new list of IDs, checks if they're in the existing list of identity joins
 * @param newIds
 * @param existingIdentityJoins
 */
export const isDuplicateIdentityJoin = (
  newIds: string[],
  existingIdentityJoins: IdentityJoinQuery[],
): boolean => {
  const existingElement = existingIdentityJoins.find((item) => {
    return isEqual(sortBy(item.ids), sortBy(newIds));
  });
  return !!existingElement;
};
