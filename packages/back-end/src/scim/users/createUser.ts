import { createApiRequestHandler } from "../../util/handler";
import {
  createUser as createNewUser,
  getUserByEmail,
} from "../../services/users";
import { addMemberToOrg } from "../../services/organizations";

export const createUser = createApiRequestHandler()(
  async (req: any): Promise<any> => {
    const requestBody = req.body.toString("utf-8");

    const requestBodyObject = JSON.parse(requestBody);

    const org = req.organization;

    if (!org) {
      // Return an error in the shape SCIM is expecting
    }

    try {
      // Look up the user in Mongo
      let user = await getUserByEmail(requestBodyObject.userName);

      if (!user) {
        // If the user doesn't exist create the user in Mongo
        user = await createNewUser(
          requestBodyObject.displayName,
          requestBodyObject.userName,
          requestBodyObject.password
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
        role: role,
        groups: [],
        meta: {
          resourceType: "User",
        },
      };
    } catch (e) {
      console.log("error creating user", e);
      return e;
    }
  }
);
