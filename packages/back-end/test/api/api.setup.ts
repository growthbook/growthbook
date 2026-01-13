import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import merge from "lodash/merge";
import { getAuthConnection } from "back-end/src/services/auth";
import authenticateApiRequestMiddleware from "back-end/src/middleware/authenticateApiRequestMiddleware";
import app from "back-end/src/app";
import mongoInit from "back-end/src/init/mongo";
import { queueInit } from "back-end/src/init/queue";
import { getAgendaInstance } from "back-end/src/services/queueing";

jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  CRON_ENABLED: 0,
}));

jest.mock("back-end/src/services/auth", () => ({
  ...jest.requireActual("back-end/src/services/auth"),
  getAuthConnection: () => ({
    middleware: jest.fn(),
  }),
}));

jest.mock("back-end/src/middleware/authenticateApiRequestMiddleware", () => ({
  ...jest.requireActual(
    "back-end/src/middleware/authenticateApiRequestMiddleware",
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
        req.organization = reqContext?.org;
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
    updateReqContext: (v) => {
      reqContext = merge({}, reqContext, v);
    },
  };
};
