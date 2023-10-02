import { createApiRequestHandler } from "../../util/handler";
import {
  createUser as createNewUser,
  getUserByEmail,
} from "../../services/users";
import { addMemberToOrg } from "../../services/organizations";
import { OrganizationInterface } from "../../../types/organization";

export const createUser = createApiRequestHandler()(
  async (req: any): Promise<any> => {
    console.log("createUser endpoint was called");
    const requestBody = req.body.toString("utf-8");

    const requestBodyObject = JSON.parse(requestBody);

    console.log("requestBodyObject", requestBodyObject);

    const org: OrganizationInterface = req.organization;

    console.log("org,id", org.id);

    if (!org) {
      return {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: 0,
        Resources: [],
        startIndex: 1,
        itemsPerPage: 20,
      };
    }

    try {
      // Look up the user in Mongo
      let user = await getUserByEmail(requestBodyObject.userName);

      console.log("user?.id", user?.id);

      if (user) {
        const userAlreadyExistsInOrg = org.members.find(
          (member) => member.id === user.id
        );

        if (userAlreadyExistsInOrg) {
          return {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
            scimType: "uniqueness",
            detail: "User already exists in this organization",
            status: 409,
          };
        }
      } else {
        user = await createNewUser(
          requestBodyObject.displayName,
          requestBodyObject.userName,
          requestBodyObject.password || "testing123",
          requestBodyObject.externalId
        );
      }

      const role = org.settings?.defaultRole?.role || "readonly";

      await addMemberToOrg({
        organization: org,
        userId: user.id,
        role,
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: undefined,
      });

      // Add them to the org's members array
      return {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        id: requestBodyObject.externalId,
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
        role: role,
        groups: [],
        meta: {
          resourceType: "User",
        },
      };
    } catch (e) {
      return {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: `Unable to create the new user in GrowthBook: ${e.message}`,
        status: 500,
      };
    }
  }
);
