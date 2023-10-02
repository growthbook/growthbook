import { updateOrganization } from "../../models/OrganizationModel";
import { getUserByExternalId } from "../../services/users";
import { createApiRequestHandler } from "../../util/handler";

export const updateUser = createApiRequestHandler()(
  async (req: any): Promise<any> => {
    console.log("patchUser was called");

    const requestBody = req.body.toString("utf-8");

    const requestBodyObject = JSON.parse(requestBody);
    console.log("requestBodyObject", requestBodyObject);

    const org = req.organization;

    console.log("req.organization", req.organization.id);

    console.log("req.params.id", req.params.id);

    if (!org) {
      // Return an error in the shape SCIM is expecting
    }

    const requestToRemoveUser =
      requestBodyObject.Operations[0].value.active === false;

    if (!requestToRemoveUser) {
      // throw error that this isn't supported or return something
    }

    // Look up the user in the org's member list
    const userIndex = org.members.findIndex(
      (member: any) => member.id === req.params.id
    );

    const updatedOrg = org;

    updatedOrg.members.splice(userIndex, 1);

    await updateOrganization(org.id, updatedOrg);

    const user = await getUserByExternalId(req.params.id);

    if (!user) {
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
        role: updatedOrg[userIndex].role,
        groups: [],
        meta: {
          resourceType: "User",
        },
      },
    ];

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
