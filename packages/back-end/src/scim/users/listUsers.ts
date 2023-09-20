import { createApiRequestHandler } from "../../util/handler";

export const listUsers = createApiRequestHandler()(
  async (req): Promise<any> => {
    console.log("made it to the list users endpoint");
    // console.log("list endpoint req", req);

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 0,
      Resources: [],
      startIndex: 1,
      itemsPerPage: 20,
    };
  }
);
