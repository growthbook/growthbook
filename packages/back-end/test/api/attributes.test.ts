import request from "supertest";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/models/OrganizationModel", () => ({
  updateOrganization: jest.fn(),
}));

describe("attributes API", () => {
  const { app, auditMock, setReqContext } = setupApp();

  afterEach(async () => {
    jest.clearAllMocks();
  });

  it("can list all attributes", async () => {
    setReqContext({
      org: {
        settings: {
          attributeSchema: [
            {
              property: "attr1",
              datatype: "string[]",
              projects: ["bla"],
            },
            {
              property: "attr2",
              datatype: "string",
            },
          ],
        },
      },
      permissions: {
        canReadMultiProjectResource: () => true,
      },
    });

    const response = await request(app)
      .get("/api/v1/attributes")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      attributes: [
        {
          property: "attr1",
          datatype: "string[]",
          projects: ["bla"],
        },
        {
          property: "attr2",
          datatype: "string",
        },
      ],
    });
  });

  it("can filter attributes", async () => {
    setReqContext({
      org: {
        settings: {
          attributeSchema: [
            {
              property: "attr1",
              datatype: "string[]",
              projects: ["bla"],
            },
            {
              property: "attr2",
              datatype: "string",
            },
          ],
        },
      },
      permissions: {
        canReadMultiProjectResource: (projects) =>
          (projects || []).includes("bla"),
      },
    });

    const response = await request(app)
      .get("/api/v1/attributes")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      attributes: [
        {
          property: "attr1",
          datatype: "string[]",
          projects: ["bla"],
        },
      ],
    });
  });

  it("can delete attributes", async () => {
    setReqContext({
      org: {
        id: "org1",
        settings: {
          attributeSchema: [
            {
              property: "attr1",
              datatype: "string[]",
              projects: ["bla"],
            },
            {
              property: "attr2",
              datatype: "string",
            },
          ],
        },
      },
      permissions: {
        canDeleteAttribute: () => true,
      },
    });

    const response = await request(app)
      .delete("/api/v1/attributes/attr1")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deletedProperty: "attr1" });
    expect(updateOrganization).toHaveBeenCalledWith("org1", {
      settings: {
        attributeSchema: [{ property: "attr2", datatype: "string" }],
      },
    });
    expect(auditMock).toHaveBeenCalledWith({
      details:
        '{"pre":{"property":"attr1","datatype":"string[]","projects":["bla"]},"context":{}}',
      entity: { id: "attr1", object: "attribute" },
      event: "attribute.delete",
    });
  });

  it("checks for permission to delete attributes", async () => {
    setReqContext({
      org: {
        id: "org1",
        settings: {
          attributeSchema: [
            {
              property: "attr1",
              datatype: "string[]",
              projects: ["bla"],
            },
            {
              property: "attr2",
              datatype: "string",
            },
          ],
        },
      },
      permissions: {
        canDeleteAttribute: () => false,
        throwPermissionError: () => {
          throw new Error("permission error");
        },
      },
    });

    const response = await request(app)
      .delete("/api/v1/attributes/attr1")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "permission error" });
    expect(updateOrganization).not.toHaveBeenCalledWith();
  });

  it("can update attributes", async () => {
    setReqContext({
      models: {
        projects: {
          getAll: () => [{ id: "proj1" }, { id: "proj2" }, { id: "proj3" }],
        },
      },
      org: {
        id: "org1",
        settings: {
          attributeSchema: [
            {
              property: "attr1",
              datatype: "string[]",
              projects: ["bla"],
            },
            {
              property: "attr2",
              datatype: "string",
            },
          ],
        },
      },
      permissions: {
        canUpdateAttribute: () => true,
      },
    });

    const response = await request(app)
      .put("/api/v1/attributes/attr1")
      .send({
        description: "new description",
        projects: ["proj1", "proj2"],
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      attribute: {
        property: "attr1",
        datatype: "string[]",
        description: "new description",
        projects: ["proj1", "proj2"],
      },
    });
    expect(updateOrganization).toHaveBeenCalledWith("org1", {
      settings: {
        attributeSchema: [
          {
            property: "attr1",
            datatype: "string[]",
            description: "new description",
            projects: ["proj1", "proj2"],
          },
          { property: "attr2", datatype: "string" },
        ],
      },
    });
    expect(auditMock).toHaveBeenCalledWith({
      details:
        '{"pre":{"property":"attr1","datatype":"string[]","projects":["bla"]},"post":{"property":"attr1","datatype":"string[]","projects":["proj1","proj2"],"description":"new description"},"context":{}}',
      entity: {
        id: "attr1",
        object: "attribute",
      },
      event: "attribute.update",
    });
  });

  it("refuses to update projects when they do not exist", async () => {
    setReqContext({
      models: {
        projects: {
          getAll: () => [{ id: "proj1" }, { id: "proj3" }],
        },
      },
      org: {
        id: "org1",
        settings: {
          attributeSchema: [
            {
              property: "attr1",
              datatype: "string[]",
              projects: ["bla"],
            },
            {
              property: "attr2",
              datatype: "string",
            },
          ],
        },
      },
      permissions: {
        canUpdateAttribute: () => true,
      },
    });

    const response = await request(app)
      .put("/api/v1/attributes/attr1")
      .send({
        description: "new description",
        projects: ["proj1", "proj2"],
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "The following projects do not exist: proj2",
    });
    expect(updateOrganization).not.toHaveBeenCalledWith();
    expect(auditMock).not.toHaveBeenCalledWith();
  });

  it("validates update payload", async () => {
    setReqContext({
      org: {
        id: "org1",
        settings: {
          attributeSchema: [
            {
              property: "attr1",
              datatype: "string[]",
            },
            {
              property: "attr2",
              datatype: "string",
            },
          ],
        },
      },
      permissions: {
        canUpdateAttribute: () => true,
      },
    });

    const response = await request(app)
      .put("/api/v1/attributes/attr1")
      .send({
        hashAttribute: "Gni",
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message:
        "Request body: [hashAttribute] Invalid input: expected boolean, received string",
    });
    expect(updateOrganization).not.toHaveBeenCalledWith();
    expect(auditMock).not.toHaveBeenCalledWith();
  });

  it("checks for update permission", async () => {
    setReqContext({
      models: {
        projects: {
          getAll: () => [{ id: "bla" }],
        },
      },
      org: {
        id: "org1",
        settings: {
          attributeSchema: [
            {
              property: "attr1",
              datatype: "string[]",
              projects: ["bla"],
            },
            {
              property: "attr2",
              datatype: "string",
            },
          ],
        },
      },
      permissions: {
        canUpdateAttribute: () => false,
        throwPermissionError: () => {
          throw new Error("permission error");
        },
      },
    });

    const response = await request(app)
      .put("/api/v1/attributes/attr1")
      .send({
        description: "bla",
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "permission error",
    });
    expect(updateOrganization).not.toHaveBeenCalledWith();
    expect(auditMock).not.toHaveBeenCalledWith();
  });

  it("can create attributes", async () => {
    setReqContext({
      models: {
        projects: {
          getAll: () => [{ id: "proj1" }, { id: "proj2" }, { id: "proj3" }],
        },
      },
      org: {
        id: "org1",
        settings: {
          attributeSchema: [
            {
              property: "attr1",
              datatype: "string[]",
              projects: ["bla"],
            },
            {
              property: "attr2",
              datatype: "string",
            },
          ],
        },
      },
      permissions: {
        canCreateAttribute: () => true,
      },
    });

    const response = await request(app)
      .post("/api/v1/attributes")
      .send({
        property: "attr3",
        datatype: "boolean",
        projects: ["proj1", "proj2"],
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      attribute: {
        property: "attr3",
        datatype: "boolean",
        projects: ["proj1", "proj2"],
      },
    });
    expect(updateOrganization).toHaveBeenCalledWith("org1", {
      settings: {
        attributeSchema: [
          {
            property: "attr1",
            datatype: "string[]",
            projects: ["bla"],
          },
          {
            property: "attr2",
            datatype: "string",
          },
          {
            property: "attr3",
            datatype: "boolean",
            projects: ["proj1", "proj2"],
          },
        ],
      },
    });
    expect(auditMock).toHaveBeenCalledWith({
      details:
        '{"post":{"property":"attr3","datatype":"boolean","projects":["proj1","proj2"]},"context":{}}',
      entity: {
        id: "attr3",
        object: "attribute",
      },
      event: "attribute.create",
    });
  });

  it("refuses to create with projects that do not exist", async () => {
    setReqContext({
      models: {
        projects: {
          getAll: () => [{ id: "proj1" }, { id: "proj3" }],
        },
      },
      org: {
        id: "org1",
        settings: {
          attributeSchema: [
            {
              property: "attr1",
              datatype: "string[]",
              projects: ["bla"],
            },
            {
              property: "attr2",
              datatype: "string",
            },
          ],
        },
      },
      permissions: {
        canCreateAttribute: () => true,
      },
    });

    const response = await request(app)
      .post("/api/v1/attributes")
      .send({
        property: "attr3",
        datatype: "boolean",
        projects: ["proj1", "proj2"],
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "The following projects do not exist: proj2",
    });
    expect(updateOrganization).not.toHaveBeenCalledWith();
    expect(auditMock).not.toHaveBeenCalledWith();
  });

  it("validates create payload", async () => {
    setReqContext({
      org: {
        id: "org1",
        settings: {
          attributeSchema: [
            {
              property: "attr1",
              datatype: "string[]",
              projects: ["bla"],
            },
            {
              property: "attr2",
              datatype: "string",
            },
          ],
        },
      },
      permissions: {
        canCreateAttribute: () => true,
      },
    });

    const response = await request(app)
      .post("/api/v1/attributes")
      .send({
        datatype: "string[]",
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message:
        "Request body: [property] Invalid input: expected string, received undefined",
    });
    expect(updateOrganization).not.toHaveBeenCalledWith();
    expect(auditMock).not.toHaveBeenCalledWith();
  });

  it("checks for create permission", async () => {
    setReqContext({
      models: {
        projects: {
          getAll: () => [{ id: "bla" }],
        },
      },
      org: {
        id: "org1",
        settings: {
          attributeSchema: [
            {
              property: "attr1",
              datatype: "string[]",
              projects: ["bla"],
            },
            {
              property: "attr2",
              datatype: "string",
            },
          ],
        },
      },
      permissions: {
        canCreateAttribute: () => false,
        throwPermissionError: () => {
          throw new Error("permission error");
        },
      },
    });

    const response = await request(app)
      .post("/api/v1/attributes")
      .send({
        property: "attr3",
        description: "new attr",
        datatype: "boolean",
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "permission error",
    });
    expect(updateOrganization).not.toHaveBeenCalledWith();
    expect(auditMock).not.toHaveBeenCalledWith();
  });

  it("fails to create attributes with an empty property", async () => {
    setReqContext({
      models: {
        projects: {
          getAll: () => [{ id: "proj1" }, { id: "proj2" }, { id: "proj3" }],
        },
      },
      org: {
        id: "org1",
        settings: {
          attributeSchema: [
            {
              property: "attr1",
              datatype: "string[]",
              projects: ["bla"],
            },
            {
              property: "attr2",
              datatype: "string",
            },
          ],
        },
      },
      permissions: {
        canCreateAttribute: () => true,
      },
    });

    const response = await request(app)
      .post("/api/v1/attributes")
      .send({
        property: "",
        datatype: "string",
        projects: ["proj1", "proj2"],
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "Attribute property cannot empty!",
    });
    expect(updateOrganization).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });
});
