import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { getAuthConnection } from "../../src/services/auth";
import authenticateApiRequestMiddleware from "../../src/middleware/authenticateApiRequestMiddleware";
import app from "../../src/app";

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
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      const collection = collections[key];
      await collection.deleteMany();
    }
  });

  it("can list all enviromnets", async () => {
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

  it("can list all enviromnets", async () => {
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
});
