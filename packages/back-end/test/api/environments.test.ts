import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { getAuthConnection } from "../../src/services/auth";
import authenticateApiRequestMiddleware from "../../src/middleware/authenticateApiRequestMiddleware";
import app from "../../src/app";
import { updateOrganization } from "../../src/models/OrganizationModel";
import { findAllProjectsByOrganization } from "../../src/models/ProjectModel";

jest.mock("../../src/models/ProjectModel", () => ({
  findAllProjectsByOrganization: jest.fn(),
}));

jest.mock("../../src/models/OrganizationModel", () => ({
  updateOrganization: jest.fn(),
}));

jest.mock("../../src/init/queue", () => ({
  queueInit: () => undefined,
}));

jest.mock("../../src/services/auth", () => ({
  ...jest.requireActual("../../src/services/auth"),
  getAuthConnection: () => ({
    middleware: jest.fn(),
  }),
}));

jest.mock("../../src/middleware/authenticateApiRequestMiddleware", () => ({
  ...jest.requireActual(
    "../../src/middleware/authenticateApiRequestMiddleware"
  ),
  __esModule: true,
  default: jest.fn(),
}));

let mongod;

describe("environements API", () => {
  const OLD_ENV = process.env;

  beforeAll(async () => {
    jest.resetModules();
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.MONGO_URL = uri;
    getAuthConnection().middleware.mockImplementation((req, res, next) => {
      next();
    });
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongod.stop();
    process.env = OLD_ENV;
  });

  afterEach(async () => {
    jest.clearAllMocks();
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      const collection = collections[key];
      await collection.deleteMany();
    }
  });

  it("can list all environments", async () => {
    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.context = {
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
      };

      next();
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
    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.context = {
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
          canReadMultiProjectResource: (projects) => projects.includes("bla"),
        },
      };

      next();
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
    const auditMock = jest.fn();

    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.audit = auditMock;
      req.context = {
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
      };

      next();
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
    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.context = {
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
        },
      };

      next();
    });

    const response = await request(app)
      .delete("/api/v1/environments/env1")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "You do not have permission to delete this environment!",
    });
    expect(updateOrganization).not.toHaveBeenCalledWith();
  });

  it("can update environments", async () => {
    const auditMock = jest.fn();
    findAllProjectsByOrganization.mockReturnValue([
      { id: "proj1" },
      { id: "proj2" },
      { id: "proj3" },
    ]);

    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.audit = auditMock;
      req.context = {
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
          canCreateOrUpdateEnvironment: () => true,
        },
      };

      next();
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
    const auditMock = jest.fn();
    findAllProjectsByOrganization.mockReturnValue([
      { id: "proj1" },
      { id: "proj3" },
    ]);

    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.audit = auditMock;
      req.context = {
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
          canCreateOrUpdateEnvironment: () => true,
        },
      };

      next();
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
    const auditMock = jest.fn();

    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.audit = auditMock;
      req.context = {
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
          canCreateOrUpdateEnvironment: () => true,
        },
      };

      next();
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
      message: "Request body: [toggleOnList] Expected boolean, received string",
    });
    expect(updateOrganization).not.toHaveBeenCalledWith();
    expect(auditMock).not.toHaveBeenCalledWith();
  });

  it("checks for update permission", async () => {
    const auditMock = jest.fn();
    findAllProjectsByOrganization.mockReturnValue([{ id: "bla" }]);

    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.audit = auditMock;
      req.context = {
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
          canCreateOrUpdateEnvironment: () => false,
        },
      };

      next();
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
      message: "You don't have permission to update this environment!",
    });
    expect(updateOrganization).not.toHaveBeenCalledWith();
    expect(auditMock).not.toHaveBeenCalledWith();
  });

  it("can create environments", async () => {
    const auditMock = jest.fn();
    findAllProjectsByOrganization.mockReturnValue([
      { id: "proj1" },
      { id: "proj2" },
      { id: "proj3" },
    ]);

    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.audit = auditMock;
      req.context = {
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
          canCreateOrUpdateEnvironment: () => true,
        },
      };

      next();
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
    const auditMock = jest.fn();
    findAllProjectsByOrganization.mockReturnValue([
      { id: "proj1" },
      { id: "proj3" },
    ]);

    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.audit = auditMock;
      req.context = {
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
          canCreateOrUpdateEnvironment: () => true,
        },
      };

      next();
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
    const auditMock = jest.fn();

    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.audit = auditMock;
      req.context = {
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
          canCreateOrUpdateEnvironment: () => true,
        },
      };

      next();
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
      message: "Request body: [id] Required, [description] Required",
    });
    expect(updateOrganization).not.toHaveBeenCalledWith();
    expect(auditMock).not.toHaveBeenCalledWith();
  });

  it("checks for create permission", async () => {
    const auditMock = jest.fn();
    findAllProjectsByOrganization.mockReturnValue([{ id: "bla" }]);

    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.audit = auditMock;
      req.context = {
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
          canCreateOrUpdateEnvironment: () => false,
        },
      };

      next();
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
      message: "You don't have permission to create this environment!",
    });
    expect(updateOrganization).not.toHaveBeenCalledWith();
    expect(auditMock).not.toHaveBeenCalledWith();
  });

  it("fails to create environments with an empty ID", async () => {
    const auditMock = jest.fn();
    findAllProjectsByOrganization.mockReturnValue([
      { id: "proj1" },
      { id: "proj2" },
      { id: "proj3" },
    ]);

    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.audit = auditMock;
      req.context = {
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
          canCreateOrUpdateEnvironment: () => true,
        },
      };

      next();
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
