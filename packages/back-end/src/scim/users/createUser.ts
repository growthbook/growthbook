import { createApiRequestHandler } from "../../util/handler";
import { createUser as createNewUser } from "../../services/users";
import { addMemberToOrg, getOrgFromReq } from "../../services/organizations";
import { MemberRole } from "../../../types/organization";

export const createUser = createApiRequestHandler()(
  async (req): Promise<any> => {
    console.log("createUser endpoint was hit");
    const requestBody = req.body.toString("utf-8");

    const requestBodyObject = JSON.parse(requestBody);
    console.log("requestBodyObject", requestBodyObject);

    const org = req.organization;

    if (!org) {
      // Return an error in the shape SCIM is expecting
    }

    try {
      // Create the user in Mongo
      const user = await createNewUser(
        requestBodyObject.displayName,
        requestBodyObject.userName,
        requestBodyObject.password
      );

      console.log("user created in Mongo", user);

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
