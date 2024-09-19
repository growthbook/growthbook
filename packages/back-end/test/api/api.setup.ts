import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getAuthConnection } from "../../src/services/auth";
import authenticateApiRequestMiddleware from "../../src/middleware/authenticateApiRequestMiddleware";
import app from "../../src/app";
import mongoInit from "../../src/init/mongo";
import { queueInit } from "../../src/init/queue";
import { getAgendaInstance } from "../../src/services/queueing";

jest.mock("../../src/util/secrets", () => ({
  ...jest.requireActual("../../src/util/secrets"),
  CRON_ENABLED: 1,
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

export const setupApp = () => {
  let mongodb;
  let reqContext;
  const auditMock = jest.fn();
  const OLD_ENV = process.env;
  const isReady = new Promise((resolve) => {
    beforeAll(async () => {
      mongodb = await MongoMemoryServer.create();
      const uri = mongodb.getUri();
      process.env.MONGO_URL = uri;
      getAuthConnection().middleware.mockImplementation((req, res, next) => {
        next();
      });

      authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
        req.audit = auditMock;
        req.context = reqContext;
        next();
      });

      await mongoInit();
      await queueInit();
      // This seems to help:
      setTimeout(resolve, 100);
    });

    afterAll(async () => {
      await getAgendaInstance().stop();
      await mongoose.connection.close();
      await mongodb.stop();
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
  });

  return {
    app,
    auditMock,
    isReady,
    setReqContext: (v) => {
      reqContext = v;
    },
  };
};
