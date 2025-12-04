import request from "supertest";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/models/OrganizationModel", () => ({
  updateOrganization: jest.fn(),
}));

describe("environements API", () => {
  const { app, auditMock, setReqContext } = setupApp();

  afterEach(async () => {
    jest.clearAllMocks();
  });

  it("can list all environments", async () => {
    setReqContext({
      org: {
        settings: {
          environments: [
            {
              id: "env1",
              description: "env1",
              toggleOnList: true,
              defaultState: true,
              projects: ["bla"],
            },
            {
              id: "env2",
            },
          ],
        },
      },
      permissions: {
        canReadMultiProjectResource: () => true,
      },
    });

    const response = await request(app)
      .get("/api/v1/environments")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      environments: [
        {
          id: "env1",
          description: "env1",
          toggleOnList: true,
          defaultState: true,
          projects: ["bla"],
        },
        {
          id: "env2",
          description: "",
          toggleOnList: false,
          defaultState: false,
          projects: [],
        },
      ],
    });
  });

  it("can filter environments", async () => {
    setReqContext({
      org: {
        settings: {
          environments: [
            {
              id: "env1",
              description: "env1",
              toggleOnList: true,
              defaultState: true,
              projects: ["bla"],
            },
            {
              id: "env2",
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
      .get("/api/v1/environments")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      environments: [
        {
          id: "env1",
          description: "env1",
          toggleOnList: true,
          defaultState: true,
          projects: ["bla"],
        },
      ],
    });
  });

  it("can delete environments", async () => {
    setReqContext({
      org: {
        id: "org1",
        settings: {
          environments: [
            {
              id: "env1",
              description: "env1",
              toggleOnList: true,
              defaultState: true,
              projects: ["bla"],
            },
            {
              id: "env2",
            },
          ],
        },
      },
      permissions: {
        canDeleteEnvironment: () => true,
      },
    });

    const response = await request(app)
      .delete("/api/v1/environments/env1")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deletedId: "env1" });
    expect(updateOrganization).toHaveBeenCalledWith("org1", {
      settings: { environments: [{ id: "env2" }] },
    });
    expect(auditMock).toHaveBeenCalledWith({
      details:
        '{"pre":{"id":"env1","description":"env1","toggleOnList":true,"defaultState":true,"projects":["bla"]},"context":{}}',
      entity: { id: "env1", object: "environment" },
      event: "environment.delete",
    });
  });

  it("checks for permission to delete environments", async () => {
    setReqContext({
      org: {
        id: "org1",
        settings: {
          environments: [
            {
              id: "env1",
              description: "env1",
              toggleOnList: true,
              defaultState: true,
              projects: ["bla"],
            },
            {
              id: "env2",
            },
          ],
        },
      },
      permissions: {
        canDeleteEnvironment: () => false,
        throwPermissionError: () => {
          throw new Error("permission error");
        },
      },
    });

    const response = await request(app)
      .delete("/api/v1/environments/env1")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "permission error" });
    expect(updateOrganization).not.toHaveBeenCalledWith();
  });

  it("can update environments", async () => {
    setReqContext({
      models: {
        projects: {
          getAll: () => [{ id: "proj1" }, { id: "proj2" }, { id: "proj3" }],
        },
      },
      org: {
        id: "org1",
        settings: {
          environments: [
            {
              id: "env1",
              description: "env1",
              toggleOnList: true,
              defaultState: true,
              projects: ["bla"],
            },
            {
              id: "env2",
            },
          ],
        },
      },
      permissions: {
        canUpdateEnvironment: () => true,
      },
    });

    const response = await request(app)
      .put("/api/v1/environments/env1")
      .send({
        description: "new description",
        toggleOnList: false,
        defaultState: false,
        projects: ["proj1", "proj2"],
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      environment: {
        defaultState: false,
        description: "new description",
        id: "env1",
        projects: ["proj1", "proj2"],
        toggleOnList: false,
      },
    });
    expect(updateOrganization).toHaveBeenCalledWith("org1", {
      settings: {
        environments: [
          {
            id: "env1",
            description: "new description",
            toggleOnList: false,
            defaultState: false,
            projects: ["proj1", "proj2"],
          },
          { id: "env2" },
        ],
      },
    });
    expect(auditMock).toHaveBeenCalledWith({
      details:
        '{"pre":{"id":"env1","description":"env1","toggleOnList":true,"defaultState":true,"projects":["bla"]},"post":{"id":"env1","projects":["proj1","proj2"],"description":"new description","toggleOnList":false,"defaultState":false},"context":{}}',
      entity: {
        id: "env1",
        object: "environment",
      },
      event: "environment.update",
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
          environments: [
            {
              id: "env1",
              description: "env1",
              toggleOnList: true,
              defaultState: true,
              projects: ["bla"],
            },
            {
              id: "env2",
            },
          ],
        },
      },
      permissions: {
        canUpdateEnvironment: () => true,
      },
    });

    const response = await request(app)
      .put("/api/v1/environments/env1")
      .send({
        description: "new description",
        toggleOnList: false,
        defaultState: false,
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
          environments: [
            {
              id: "env1",
              description: "env1",
              toggleOnList: true,
              defaultState: true,
              projects: ["bla"],
            },
            {
              id: "env2",
            },
          ],
        },
      },
      permissions: {
        canUpdateEnvironment: () => true,
      },
    });

    const response = await request(app)
      .put("/api/v1/environments/env1")
      .send({
        toggleOnList: "Gni",
        defaultState: false,
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message:
        "Request body: [toggleOnList] Invalid input: expected boolean, received string",
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
          environments: [
            {
              id: "env1",
              description: "env1",
              toggleOnList: true,
              defaultState: true,
              projects: ["bla"],
            },
            {
              id: "env2",
            },
          ],
        },
      },
      permissions: {
        canUpdateEnvironment: () => false,
        throwPermissionError: () => {
          throw new Error("permission error");
        },
      },
    });

    const response = await request(app)
      .put("/api/v1/environments/env1")
      .send({
        toggleOnList: true,
        defaultState: false,
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "permission error",
    });
    expect(updateOrganization).not.toHaveBeenCalledWith();
    expect(auditMock).not.toHaveBeenCalledWith();
  });

  it("can create environments", async () => {
    setReqContext({
      models: {
        projects: {
          getAll: () => [{ id: "proj1" }, { id: "proj2" }, { id: "proj3" }],
        },
      },
      org: {
        id: "org1",
        settings: {
          environments: [
            {
              id: "env1",
              description: "env1",
              toggleOnList: true,
              defaultState: true,
              projects: ["bla"],
            },
            {
              id: "env2",
            },
          ],
        },
      },
      permissions: {
        canCreateEnvironment: () => true,
      },
    });

    const response = await request(app)
      .post("/api/v1/environments")
      .send({
        id: "env3",
        description: "new description",
        toggleOnList: false,
        defaultState: false,
        projects: ["proj1", "proj2"],
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      environment: {
        defaultState: false,
        description: "new description",
        id: "env3",
        projects: ["proj1", "proj2"],
        toggleOnList: false,
      },
    });
    expect(updateOrganization).toHaveBeenCalledWith("org1", {
      settings: {
        environments: [
          {
            id: "env1",
            description: "env1",
            toggleOnList: true,
            defaultState: true,
            projects: ["bla"],
          },
          {
            id: "env2",
          },
          {
            id: "env3",
            description: "new description",
            toggleOnList: false,
            defaultState: false,
            projects: ["proj1", "proj2"],
          },
        ],
      },
    });
    expect(auditMock).toHaveBeenCalledWith({
      details:
        '{"post":{"id":"env3","projects":["proj1","proj2"],"description":"new description","toggleOnList":false,"defaultState":false},"context":{}}',
      entity: {
        id: "env3",
        object: "environment",
      },
      event: "environment.create",
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
          environments: [
            {
              id: "env1",
              description: "env1",
              toggleOnList: true,
              defaultState: true,
              projects: ["bla"],
            },
            {
              id: "env2",
            },
          ],
        },
      },
      permissions: {
        canCreateEnvironment: () => true,
      },
    });

    const response = await request(app)
      .post("/api/v1/environments")
      .send({
        id: "env3",
        description: "new description",
        toggleOnList: false,
        defaultState: false,
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
          environments: [
            {
              id: "env1",
              description: "env1",
              toggleOnList: true,
              defaultState: true,
              projects: ["bla"],
            },
            {
              id: "env2",
            },
          ],
        },
      },
      permissions: {
        canCreateEnvironment: () => true,
      },
    });

    const response = await request(app)
      .post("/api/v1/environments")
      .send({
        toggleOnList: "Gni",
        defaultState: false,
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message:
        "Request body: [id] Invalid input: expected string, received undefined",
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
          environments: [
            {
              id: "env1",
              description: "env1",
              toggleOnList: true,
              defaultState: true,
              projects: ["bla"],
            },
            {
              id: "env2",
            },
          ],
        },
      },
      permissions: {
        canCreateEnvironment: () => false,
        throwPermissionError: () => {
          throw new Error("permission error");
        },
      },
    });

    const response = await request(app)
      .post("/api/v1/environments")
      .send({
        id: "env3",
        description: "new env",
        toggleOnList: true,
        defaultState: false,
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "permission error",
    });
    expect(updateOrganization).not.toHaveBeenCalledWith();
    expect(auditMock).not.toHaveBeenCalledWith();
  });

  it("fails to create environments with an empty ID", async () => {
    setReqContext({
      models: {
        projects: {
          getAll: () => [{ id: "proj1" }, { id: "proj2" }, { id: "proj3" }],
        },
      },
      org: {
        id: "org1",
        settings: {
          environments: [
            {
              id: "env1",
              description: "env1",
              toggleOnList: true,
              defaultState: true,
              projects: ["bla"],
            },
            {
              id: "env2",
            },
          ],
        },
      },
      permissions: {
        canCreateEnvironment: () => true,
      },
    });

    const response = await request(app)
      .post("/api/v1/environments")
      .send({
        id: "",
        description: "new description",
        toggleOnList: false,
        defaultState: false,
        projects: ["proj1", "proj2"],
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Environment ID cannot empty!" });
    expect(updateOrganization).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });
});
