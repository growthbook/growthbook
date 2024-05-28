import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { getAuthConnection } from "../../src/services/auth";
import authenticateApiRequestMiddleware from "../../src/middleware/authenticateApiRequestMiddleware";
import app from "../../src/app";
import {
  toApiSDKConnectionInterface,
  findSDKConnectionsByOrganization,
  createSDKConnection,
} from "../../src/models/SdkConnectionModel";
import { sdkConnectionFactory } from "../factories/SdkConnection.factory";

jest.mock("../../src/models/SdkConnectionModel", () => ({
  ...jest.requireActual("../../src/models/SdkConnectionModel"),
  createSDKConnection: jest.fn(),
  findSDKConnectionsByOrganization: jest.fn(),
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

describe("sdk-connections API", () => {
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

  const org = { id: "org", environments: [{ id: "production" }] };

  it("can list all sdk-connections", async () => {
    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.context = { org };
      next();
    });

    const connections = [...Array(10)].map(() =>
      sdkConnectionFactory.build({
        organization: org.id,
        environments: org.environments[0],
      })
    );

    findSDKConnectionsByOrganization.mockReturnValue(connections);

    const response = await request(app)
      .get("/api/v1/sdk-connections")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      connections: connections.map(toApiSDKConnectionInterface),
      count: 10,
      hasMore: false,
      limit: 10,
      nextOffset: null,
      offset: 0,
      total: 10,
    });
  });

  it("can paginate sdk-connections", async () => {
    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.context = { org };
      next();
    });

    const connections = [...Array(10)].map(() =>
      sdkConnectionFactory.build({
        organization: org.id,
        environment: org.environments[0].id,
      })
    );

    findSDKConnectionsByOrganization.mockReturnValue(connections);

    const response = await request(app)
      .get("/api/v1/sdk-connections?limit=5&offset=5")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      connections: connections.slice(5, 11).map(toApiSDKConnectionInterface),
      count: 5,
      hasMore: false,
      limit: 5,
      nextOffset: null,
      offset: 5,
      total: 10,
    });
  });

  it("can create new sdk-connections", async () => {
    authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
      req.context = {
        org,
        permissions: { canCreateSDKConnection: () => true },
      };
      next();
    });

    let created;

    createSDKConnection.mockImplementation((v) => {
      created = sdkConnectionFactory.build(v);
      return created;
    });

    const connection = {
      name: "my-connection",
      environment: org.environments[0].id,
      language: "javascript",
    };

    const response = await request(app)
      .post("/api/v1/sdk-connections")
      .send(connection)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      sdkConnection: toApiSDKConnectionInterface(created),
    });
  });
});
