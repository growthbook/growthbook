import { randomUUID } from "crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import merge from "lodash/merge";
import { getAuthConnection } from "back-end/src/services/auth";
import authenticateApiRequestMiddleware from "back-end/src/middleware/authenticateApiRequestMiddleware";
import app from "back-end/src/app";
import mongoInit from "back-end/src/init/mongo";
import { queueInit } from "back-end/src/init/queue";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import { ReqContextClass } from "back-end/src/services/context";

vi.mock("back-end/src/util/secrets", async () => ({
  ...(await vi.importActual<typeof import("back-end/src/util/secrets")>(
    "back-end/src/util/secrets",
  )),
  CRON_ENABLED: 0,
}));

vi.mock("back-end/src/services/auth", async () => ({
  ...(await vi.importActual<typeof import("back-end/src/services/auth")>(
    "back-end/src/services/auth",
  )),
  getAuthConnection: () => ({
    middleware: vi.fn(),
  }),
}));

vi.mock(
  "back-end/src/middleware/authenticateApiRequestMiddleware",
  async () => ({
    ...(await vi.importActual<
      typeof import("back-end/src/middleware/authenticateApiRequestMiddleware")
    >("back-end/src/middleware/authenticateApiRequestMiddleware")),
    __esModule: true,
    default: vi.fn(),
  }),
);

const defaultLimits = {
  getMaxProjects: () => null,
  isEnvironmentIdAllowed: () => true,
  orgSupportsRoles: () => true,
};

export const setupApp = () => {
  // These specs boot the real Express app against an in-memory Mongo, so a
  // single test is app setup plus several round trips. Vitest's 5s default is a
  // unit-test budget and several of these files legitimately run for 40s+, so
  // individual tests overshoot it on a loaded machine without anything being
  // racy. Measured, not guessed: at the default, timeouts land on a different
  // spec each run.
  vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

  const server = createServer(app);
  let mongodb;
  let reqContext;
  const auditMock = vi.fn();
  const OLD_ENV = process.env;
  const isReady = new Promise((resolve) => {
    beforeAll(async () => {
      mongodb = await MongoMemoryServer.create();
      const uri = mongodb.getUri();
      process.env.MONGO_URL = uri;

      await mongoInit();
      await queueInit();

      // Initialize all models by creating a dummy context
      // This triggers index creation for all collections
      new ReqContextClass({
        org: {
          id: "org_dummy_for_setup",
          name: "Dummy",
          ownerEmail: "test@test.com",
          url: "",
          dateCreated: new Date(),
          members: [],
        },
        auditUser: {
          id: "dummy",
          email: "test@test.com",
          name: "Test",
        },
        teams: [],
        user: {
          id: "dummy",
          email: "test@test.com",
          name: "Test",
          superAdmin: true,
        },
      });
      // Wait for all model indexes to be created before running tests
      await waitForIndexes();
      // Keep every request in a suite on the same server.
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      resolve();
    }, 60000); // Increase timeout to 60s for CI environment

    afterAll(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await getAgendaInstance().stop();
      await mongoose.connection.close();
      await mongodb.stop();
      process.env = OLD_ENV;
    });

    beforeEach(() => {
      getAuthConnection().middleware.mockImplementation((req, res, next) => {
        next();
      });

      authenticateApiRequestMiddleware.mockImplementation((req, res, next) => {
        req.audit = auditMock;
        req.context = reqContext;
        req.organization = reqContext?.org;
        // The /api/v1 router rate-limits per req.apiKey (60 req/min). The real
        // auth middleware sets this; under this mock we give each request a
        // unique key so the limiter never crosses test boundaries.
        req.apiKey = randomUUID();
        // The real middleware sets this on every path. Without it, writes that
        // record an audit user fail validation — and because several are
        // fire-and-forget, the failure is swallowed and the specs cannot see it.
        req.eventAudit = { type: "api_key", apiKey: req.apiKey, name: "test" };
        next();
      });
    });

    afterEach(async () => {
      vi.clearAllMocks();
      const collections = mongoose.connection.collections;
      for (const key in collections) {
        const collection = collections[key];
        await collection.deleteMany();
      }
    });
  });

  return {
    app: server,
    auditMock,
    isReady,
    setReqContext: (v) => {
      // Mutate in place so tests' own `context` var stays reference-equal to req.context.
      if (!v.limits) v.limits = defaultLimits;
      reqContext = v;
    },
    updateReqContext: (v) => {
      reqContext = merge({}, reqContext, v);
    },
  };
};
