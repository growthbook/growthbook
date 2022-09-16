import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import express, { ErrorRequestHandler, Response } from "express";
import mongoInit from "./init/mongo";
import { usingFileConfig } from "./init/config";
import cors from "cors";
import { AuthRequest } from "./types/AuthRequest";
import {
  APP_ORIGIN,
  CORS_ORIGIN_REGEX,
  IS_CLOUD,
  UPLOAD_METHOD,
} from "./util/secrets";
import {
  getExperimentConfig,
  getExperimentsScript,
} from "./controllers/config";
import asyncHandler from "express-async-handler";
import pino from "pino-http";
import { verifySlackRequestSignature } from "./services/slack";
import { getJWTCheck, processJWT } from "./services/auth";
import compression from "compression";
import fs from "fs";
import path from "path";

// Controllers
import * as authController from "./controllers/auth";
import * as organizationsController from "./controllers/organizations";
import * as datasourcesController from "./controllers/datasources";
import * as experimentsController from "./controllers/experiments";
import * as metricsController from "./controllers/metrics";
import * as reportsController from "./controllers/reports";
import * as ideasController from "./controllers/ideas";
import * as presentationController from "./controllers/presentations";
import * as discussionsController from "./controllers/discussions";
import * as adminController from "./controllers/admin";
import * as stripeController from "./controllers/stripe";
import * as segmentsController from "./controllers/segments";
import * as dimensionsController from "./controllers/dimensions";
import * as projectsController from "./controllers/projects";
import * as featuresController from "./controllers/features";
import * as slackController from "./controllers/slack";
import * as tagsController from "./controllers/tags";
import { getUploadsDir } from "./services/files";
import { queueInit } from "./init/queue";
import { isEmailEnabled } from "./services/email";
import { wrapController } from "./services/routers";

import { preAuthRouter } from "./routers/preAuth";
import { organizationsRouter } from "./routers/organization";
import { tagsRouter } from "./routers/tags";
import { ideasRouter } from "./routers/ideas";
import { metricsRouter } from "./routers/metrics";
import { experimentsRouter } from "./routers/experiments";
import { reportsRouter } from "./routers/reports";
import { segmentsRouter } from "./routers/segments";
import { dimensionsRouter } from "./routers/dimensions";
import { projectsRouter } from "./routers/projects";
import { featuresRouter } from "./routers/features";
import { datasourcesRouter } from "./routers/datasources";
import { keysRouter } from "./routers/keys";
import { webhooksRouter } from "./routers/webhooks";
import { presentationsRouter } from "./routers/presentations";
import { discussionsRouter } from "./routers/discussions";
import { adminRouter } from "./routers/admin";

wrapController(authController);
wrapController(organizationsController);
wrapController(datasourcesController);
wrapController(experimentsController);
wrapController(metricsController);
wrapController(ideasController);
wrapController(presentationController);
wrapController(discussionsController);
wrapController(adminController);
wrapController(stripeController);
wrapController(segmentsController);
wrapController(dimensionsController);
wrapController(projectsController);
wrapController(featuresController);
wrapController(slackController);
wrapController(reportsController);
wrapController(tagsController);

const app = express();

let initPromise: Promise<void>;
async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await mongoInit();
      await queueInit();
    })();
  }
  try {
    await initPromise;
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

if (!process.env.NO_INIT) {
  init();
}

app.set("port", process.env.PORT || 3100);

// Pretty print on dev
if (process.env.NODE_ENV !== "production") {
  app.set("json spaces", 2);
}

app.use(cookieParser());

// Health check route (does not require JWT or cors)
app.get("/healthcheck", (req, res) => {
  // TODO: more robust health check?
  res.status(200).json({
    status: 200,
    healthy: true,
  });
});

app.get("/favicon.ico", (req, res) => {
  res.status(404).send("");
});

app.use(compression());

let build: { sha: string; date: string };
app.get("/", (req, res) => {
  if (!build) {
    build = {
      sha: "",
      date: "",
    };
    const rootPath = path.join(__dirname, "..", "..", "..", "buildinfo");
    if (fs.existsSync(path.join(rootPath, "SHA"))) {
      build.sha = fs.readFileSync(path.join(rootPath, "SHA")).toString().trim();
    }
    if (fs.existsSync(path.join(rootPath, "DATE"))) {
      build.date = fs
        .readFileSync(path.join(rootPath, "DATE"))
        .toString()
        .trim();
    }
  }

  res.json({
    name: "GrowthBook API",
    production: process.env.NODE_ENV === "production",
    api_host: req.protocol + "://" + req.hostname + ":" + app.get("port"),
    app_origin: APP_ORIGIN,
    config_source: usingFileConfig() ? "file" : "db",
    email_enabled: isEmailEnabled(),
    build,
  });
});

// Request logging
const logger = pino({
  autoLogging: process.env.NODE_ENV === "production",
  redact: {
    paths: [
      "req.headers.authorization",
      'req.headers["if-none-match"]',
      'req.headers["cache-control"]',
      'req.headers["upgrade-insecure-requests"]',
      "req.headers.cookie",
      "req.headers.connection",
      'req.headers["accept"]',
      'req.headers["accept-encoding"]',
      'req.headers["accept-language"]',
      'req.headers["sec-fetch-site"]',
      'req.headers["sec-fetch-mode"]',
      'req.headers["sec-fetch-dest"]',
      'req.headers["sec-ch-ua-mobile"]',
      'req.headers["sec-ch-ua"]',
      'req.headers["sec-fetch-user"]',
      "res.headers.etag",
      'res.headers["x-powered-by"]',
      'res.headers["access-control-allow-credentials"]',
      'res.headers["access-control-allow-origin"]',
    ],
    remove: true,
  },
  prettyPrint:
    process.env.NODE_ENV === "production"
      ? false
      : {
          colorize: true,
          translateTime: "SYS:standard",
          messageFormat: "{levelLabel} {req.url}",
        },
});
app.use(logger);

// Initialize db connections
app.use(async (req, res, next) => {
  try {
    await init();
    next();
  } catch (e) {
    next(e);
  }
});

// Visual Designer js file (does not require JWT or cors)
app.get("/js/:key.js", getExperimentsScript);

// Stripe webhook (needs raw body)
app.post(
  "/stripe/webhook",
  bodyParser.raw({
    type: "application/json",
  }),
  stripeController.postWebhook
);

// Slack app (body is urlencoded)
app.post(
  "/ideas/slack",
  bodyParser.urlencoded({
    extended: true,
    verify: verifySlackRequestSignature,
  }),
  slackController.postIdeas
);

// increase max payload json size to 1mb
app.use(bodyParser.json({ limit: "500kb" }));

// Public API routes (does not require JWT, does require cors with origin = *)
app.get(
  "/config/:key",
  cors({
    credentials: false,
    origin: "*",
  }),
  getExperimentConfig
);
app.get(
  "/api/features/:key",
  cors({
    credentials: false,
    origin: "*",
  }),
  featuresController.getFeaturesPublic
);
// For preflight requests
app.options(
  "/api/features/:key",
  cors({
    credentials: false,
    origin: "*",
  }),
  function (req, res) {
    res.send(200);
  }
);

// Accept cross-origin requests from the frontend app
const origins: (string | RegExp)[] = [APP_ORIGIN];
if (CORS_ORIGIN_REGEX) {
  origins.push(CORS_ORIGIN_REGEX);
}
app.use(
  cors({
    credentials: true,
    origin: origins,
  })
);

app.use("/auth", preAuthRouter);

// File uploads don't require auth tokens.
// Upload urls are signed and image access is public.
if (UPLOAD_METHOD === "local") {
  // Create 'uploads' directory if it doesn't exist yet
  const uploadDir = getUploadsDir();
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
  }

  app.put(
    "/upload",
    bodyParser.raw({
      type: "image/*",
      limit: "10mb",
    }),
    organizationsController.putUpload
  );
  app.use("/upload", express.static(uploadDir));

  // Stop upload requests from running any of the middlewares defined below
  app.use("/upload", () => {
    return;
  });
}

// All other routes require a valid JWT
app.use(getJWTCheck());

// Add logged in user props to the request
app.use(processJWT);

// Add logged in user props to the logger
app.use(
  (req: AuthRequest, res: Response & { log: AuthRequest["log"] }, next) => {
    res.log = req.log = req.log.child({
      userId: req.userId,
      admin: !!req.admin,
    });
    next();
  }
);

// Logged-in auth requests
// Managed cloud deployment uses Auth0 instead
if (!IS_CLOUD) {
  app.post("/auth/change-password", authController.postChangePassword);
}

// Organizations
app.get("/user", organizationsController.getUser);

// Every other route requires a userId to be set
app.use(
  asyncHandler(async (req: AuthRequest, res, next) => {
    if (!req.userId) {
      throw new Error("Must be authenticated.  Try refreshing the page.");
    }
    next();
  })
);

app.use(organizationsRouter);
app.use("/tag", tagsRouter);
app.use(ideasRouter);
app.use(metricsRouter);
app.use(experimentsRouter);
app.use(reportsRouter);
app.use("segments", segmentsRouter);
app.use("dimensions", dimensionsRouter);
app.use("projects", projectsRouter);
app.use(featuresRouter);
app.use(datasourcesRouter);
app.use(keysRouter);
app.use(webhooksRouter);
app.use(presentationsRouter);
app.use(discussionsRouter);
app.use(adminRouter);

// Fallback 404 route if nothing else matches
app.use(function (req, res) {
  res.status(404).json({
    status: 404,
    message: "Route not found",
  });
});

// eslint-disable-next-line
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const status = err.status || 400;

  if (req.log) {
    req.log.error(err);
  } else {
    logger.logger.error(err);
  }

  res.status(status).json({
    status: status,
    message: err.message || "An error occurred",
  });
};
app.use(errorHandler);

export default app;
