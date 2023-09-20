import { updateOrganization } from "../../models/OrganizationModel";
import { createApiRequestHandler } from "../../util/handler";

export const updateUser = createApiRequestHandler()(
  async (req: any): Promise<any> => {
    console.log("updateUser was called");

    const requestBody = req.body.toString("utf-8");

    const requestBodyObject = JSON.parse(requestBody);
    // console.log("requestBodyObject", requestBodyObject);

    const org = req.organization;

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

    // res.status(204);

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 0,
      Resources: [],
      startIndex: 1,
      itemsPerPage: 20,
    };
  }
);
