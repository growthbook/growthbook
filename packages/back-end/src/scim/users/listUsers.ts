import { createApiRequestHandler } from "../../util/handler";
import { getUserByEmail } from "../../services/users";
import { listUsersValidator } from "../../validators/scimapi";

// type listUsersResponse = {
//   schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"];
//   id: string;
//   userName: string;
//   name: {
//     displayName: string | undefined;
//   };
//   active: boolean;
//   emails: [
//     {
//       primary: boolean;
//       value: string;
//       type: string;
//       display: string;
//     }
//   ];
//   role: string;
//   groups: string[];
//   meta: {
//     resourceType: "User";
//   };
// };

// type emptyListUsersResponse = {
//   schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"];
//   totalResults: number;
//   Resources: string[];
//   startIndex: number;
//   itemsPerPage: number;
// };

function parseQueryFilter(queryFilter?: string) {
  const regexPattern = /(\w+) (\w+) "([^"]+)"/;

  let match;

  if (queryFilter) {
    match = regexPattern.exec(queryFilter);
  }

  // Check if there is a match
  if (match) {
    const [, filterBy, operator, value] = match; // Destructuring the matched values
    const results = {
      filterBy,
      operator,
      value,
    };
    return results;
  }
}
//TODO: There is something wrong with the listUsersValidator - it returns an error "message": "Unexpected token o in JSON at position 1"
export const listUsers = createApiRequestHandler()(
  async (req): Promise<any> => {
    //TODO: Without the validator, the line below isn't happy because filter is possibly undefined
    const queryInfo = parseQueryFilter(req.query.filter);

    const userEmail = queryInfo?.value;

    if (!userEmail) {
      return {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: 0,
        Resources: [],
        startIndex: 1,
        itemsPerPage: 20,
      };
    }

    const org = req.organization;

    if (!org) {
      // Return an error in the shape SCIM is expecting
    }

    const user = await getUserByEmail(userEmail);

    const orgUser = org.members.find((member) => member.id === user?.id);

    if (!user || !orgUser) {
      return {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: 0,
        Resources: [],
        startIndex: 1,
        itemsPerPage: 20,
      };
    }

    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: user.id,
      userName: user.email,
      name: {
        displayName: user.name,
      },
      active: true,
      emails: [
        {
          primary: true,
          value: user.email,
          type: "work",
          display: user.email,
        },
      ],
      role: orgUser.role,
      groups: [],
      meta: {
        resourceType: "User",
      },
    };
  }
);
