import { createApiRequestHandler } from "../../util/handler";
import { getUserByEmail } from "../../services/users";

export const listUsers = createApiRequestHandler()(
  async (req: any): Promise<any> => {
    const regexPattern = /(\w+) (\w+) "([^"]+)"/;

    const match = regexPattern.exec(req.query.filter);

    let userEmail;

    // Check if there is a match
    if (match) {
      const [, filterBy, operator, value] = match; // Destructuring the matched values
      const result = {
        filterBy,
        operator,
        value,
      };

      userEmail = result.value;
    }

    const org = req.organization;

    if (!org) {
      // Return an error in the shape SCIM is expecting
    }

    if (!userEmail) {
      return {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: 0,
        Resources: [],
        startIndex: 1,
        itemsPerPage: 20,
      };
    }

    const user = await getUserByEmail(userEmail);

    const orgUser = org.members.find((member: any) => member.id === user?.id);

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
