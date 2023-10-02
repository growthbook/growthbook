import { Request, Response } from "express";
import { parse, filter } from "scim2-parse-filter";
import { getUserByEmail, getUserByExternalId } from "../../services/users";
import { UserInterface } from "../../../types/user";
import { ApiRequestLocals } from "../../../types/api";
import { ScimListRequest } from "../../../types/scim";
import { expandOrgMembers } from "../../services/organizations";

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

//TODO: There is something wrong with the listUsersValidator - it returns an error "message": "Unexpected token o in JSON at position 1"
export async function listUsers(
  req: Request & ApiRequestLocals,
  res: Response
) {
  console.log("listUsers endpoint hit");
  const { startIndex, count, filter: filterQuery } = req.query;

  const org = req.organization;

  const expandedMembers = await expandOrgMembers(org.members);

  const scimUsers = expandedMembers.map((user) => {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: user.id,
      userName: user.email,
      name: {
        displayName: user.name,
        givenName: user.name.split(" ")[0],
        familyName: user.name.split(" ")[1],
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
      role: user.role,
      groups: [],
      meta: {
        resourceType: "User",
      },
    };
  });

  const filteredUsers = filterQuery
    ? scimUsers.filter(filter(parse(filterQuery as string)))
    : scimUsers;

  console.log({ filteredUsers });
  console.log({ filterQuery });

  const resources = filteredUsers.slice(
    parseInt(startIndex as string),
    parseInt(startIndex as string) + parseInt(count as string)
  );

  return res.status(200).json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: filteredUsers.length,
    Resources: filteredUsers,
    startIndex: parseInt(startIndex as string),
    itemsPerPage: parseInt(count as string),
  });
}
