import { createApiRequestHandler } from "../../util/handler";

export const listGroups = createApiRequestHandler()(
  async (req): Promise<any> => {
    console.log("listGroups endpoint was called");

    // Basic placeholder return value
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 0,
      Resources: [],
      startIndex: 1,
      itemsPerPage: 20,
    };
  }
);
