import { createApiRequestHandler } from "../../util/handler";
import { getUserByEmail, getUserByExternalId } from "../../services/users";
import { listUsersValidator } from "../../validators/scimapi";
import { UserInterface } from "../../../types/user";
import { ApiRequestLocals } from "../../../types/api";

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

function isEmailAddress(input: string): boolean {
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  return emailRegex.test(input);
}

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
    console.log("listUsers endpoint hit");
    //TODO: Without the validator, the line below isn't happy because filter is possibly undefined
    const queryInfo = parseQueryFilter(req.query.filter);

    const isFilterValueEmail = isEmailAddress(queryInfo?.value);

    console.log("isFilterValueEmail:", isFilterValueEmail);

    //TODO: Update this to be more dynamic
    const filterValue = queryInfo?.value;

    console.log("filterValue", filterValue);

    if (!filterValue) {
      return {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: 0,
        Resources: [],
        startIndex: 1,
        itemsPerPage: 20,
      };
    }

    const org = req.organization;

    console.log("org", org.id);

    if (!org) {
      return {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: 0,
        Resources: [],
        startIndex: 1,
        itemsPerPage: 20,
      };
      // Return an error in the shape SCIM is expecting
    }

    // const user = await getUserByEmail(userEmail);
    let user: UserInterface | null;

    //TODO: This should actually return a list of users, not just one
    if (isFilterValueEmail) {
      user = await getUserByEmail(filterValue);
    } else {
      user = await getUserByExternalId(filterValue);
    }

    console.log("user", user);

    //TODO: We need to loop through all users and only return those users who are a member of this org
    const orgUser = org.members.find((member) => member.id === user?.id);

    console.log("orgUser", orgUser);

    // if (!user || !orgUser) {
    //   return {
    //     schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    //     totalResults: 0,
    //     Resources: [],
    //     startIndex: 1,
    //     itemsPerPage: 20,
    //   };
    // }

    if (!user || !orgUser) {
      return {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: 0,
        Resources: [],
        startIndex: 1,
        itemsPerPage: 20,
      };
    }

    const resourcesToReturn = [
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        id: user.externalId,
        userName: user.externalId,
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
      },
    ];

    console.log("returning a user");

    //TODO: Update the totalResults so it's not hardcoded to 1
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: resourcesToReturn.length,
      Resources: resourcesToReturn,
      startIndex: 1,
      itemsPerPage: 20,
    };
  }
);
