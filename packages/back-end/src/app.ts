import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import express, {
  RequestHandler,
  ErrorRequestHandler,
  Response,
} from "express";
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
import * as experimentsController from "./controllers/experiments";
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
import { getUploadsDir } from "./services/files";
import { queueInit } from "./init/queue";
import { isEmailEnabled } from "./services/email";

// Wrap every controller function in asyncHandler to catch errors properly
// eslint-disable-next-line
function wrapController(controller: Record<string, RequestHandler<any>>): void {
  Object.keys(controller).forEach((key) => {
    if (typeof controller[key] === "function") {
      controller[key] = asyncHandler(controller[key]);
    }
  });
}
wrapController(authController);
wrapController(organizationsController);
wrapController(experimentsController);
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

app.use(bodyParser.json());

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

// Pre-auth requests
// Managed cloud deployment uses Auth0 instead
if (!IS_CLOUD) {
  app.post("/auth/refresh", authController.postRefresh);
  app.post("/auth/login", authController.postLogin);
  app.post("/auth/logout", authController.postLogout);
  app.post("/auth/register", authController.postRegister);
  app.post("/auth/firsttime", authController.postFirstTimeRegister);
  app.post("/auth/forgot", authController.postForgotPassword);
  app.get("/auth/reset/:token", authController.getResetPassword);
  app.post("/auth/reset/:token", authController.postResetPassword);
}
app.get("/auth/hasorgs", authController.getHasOrganizations);

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

// Organization and Settings
app.put("/user/name", organizationsController.putUserName);
app.get("/user/watching", organizationsController.getWatchedExperiments);
app.get("/organization/definitions", organizationsController.getDefinitions);
app.get("/activity", organizationsController.getActivityFeed);
app.get("/history/:type/:id", organizationsController.getHistory);
app.get("/organization", organizationsController.getOrganization);
app.post("/organization", organizationsController.signup);
app.put("/organization", organizationsController.putOrganization);
app.post(
  "/organization/config/import",
  organizationsController.postImportConfig
);
app.get("/organization/namespaces", organizationsController.getNamespaces);
app.post("/organization/namespaces", organizationsController.postNamespaces);
app.put("/organization/namespaces/:id", organizationsController.putNamespaces);
app.post("/invite/accept", organizationsController.postInviteAccept);
app.post("/invite", organizationsController.postInvite);
app.post("/invite/resend", organizationsController.postInviteResend);
app.delete("/invite", organizationsController.deleteInvite);
app.get("/members", organizationsController.getUsers);
app.delete("/member/:id", organizationsController.deleteMember);
app.put("/member/:id/role", organizationsController.putMemberRole);
app.get("/tags", organizationsController.getTags);
app.post("/oauth/google", organizationsController.postGoogleOauthRedirect);
app.post("/subscription/start", stripeController.postStartTrial);
app.post("/subscription/manage", stripeController.postCreateBillingSession);
app.get("/queries/:ids", organizationsController.getQueries);
app.post("/organization/sample-data", organizationsController.postSampleData);

// Ideas
app.get("/ideas", ideasController.getIdeas);
app.post("/ideas", ideasController.postIdeas);
app.get("/idea/:id", ideasController.getIdea);
app.post("/idea/:id", ideasController.postIdea);
app.delete("/idea/:id", ideasController.deleteIdea);
app.post("/idea/:id/vote", ideasController.postVote);
app.post("/ideas/impact", ideasController.getEstimatedImpact);
app.post("/ideas/estimate/manual", ideasController.postEstimatedImpactManual);
app.get("/ideas/recent/:num", ideasController.getRecentIdeas);

// Metrics
app.get("/metrics", experimentsController.getMetrics);
app.post("/metrics", experimentsController.postMetrics);
app.get("/metric/:id", experimentsController.getMetric);
app.put("/metric/:id", experimentsController.putMetric);
app.delete("/metric/:id", experimentsController.deleteMetric);
app.get("/metric/:id/usage", experimentsController.getMetricUsage);
app.post("/metric/:id/analysis", experimentsController.postMetricAnalysis);
app.get(
  "/metric/:id/analysis/status",
  experimentsController.getMetricAnalysisStatus
);
app.post(
  "/metric/:id/analysis/cancel",
  experimentsController.cancelMetricAnalysis
);

// Experiments
app.get("/experiments", experimentsController.getExperiments);
app.post("/experiments", experimentsController.postExperiments);
app.get(
  "/experiments/frequency/month/:num",
  experimentsController.getExperimentsFrequencyMonth
);
app.get("/experiments/newfeatures/", experimentsController.getNewFeatures);
app.get("/experiments/snapshots/", experimentsController.getSnapshots);
app.get("/experiment/:id", experimentsController.getExperiment);
app.get("/experiment/:id/reports", reportsController.getReportsOnExperiment);
app.get("/snapshot/:id/status", experimentsController.getSnapshotStatus);
app.post("/snapshot/:id/cancel", experimentsController.cancelSnapshot);
app.get("/experiment/:id/snapshot/:phase", experimentsController.getSnapshot);
app.get(
  "/experiment/:id/snapshot/:phase/:dimension",
  experimentsController.getSnapshotWithDimension
);
app.post("/experiment/:id/snapshot", experimentsController.postSnapshot);
app.post(
  "/experiment/:id/snapshot/:phase/preview",
  experimentsController.previewManualSnapshot
);
app.post("/experiment/:id", experimentsController.postExperiment);
app.delete("/experiment/:id", experimentsController.deleteExperiment);
app.post("/experiment/:id/watch", experimentsController.watchExperiment);
app.post("/experiment/:id/unwatch", experimentsController.unwatchExperiment);
app.post("/experiment/:id/phase", experimentsController.postExperimentPhase);
app.delete(
  "/experiment/:id/phase/:phase",
  experimentsController.deleteExperimentPhase
);
app.post("/experiment/:id/stop", experimentsController.postExperimentStop);
app.put(
  "/experiment/:id/variation/:variation/screenshot",
  experimentsController.addScreenshot
);
app.delete(
  "/experiment/:id/variation/:variation/screenshot",
  experimentsController.deleteScreenshot
);
app.post(
  "/experiment/:id/archive",
  experimentsController.postExperimentArchive
);
app.post(
  "/experiment/:id/unarchive",
  experimentsController.postExperimentUnarchive
);
app.post("/experiments/import", experimentsController.postPastExperiments);
app.get(
  "/experiments/import/:id",
  experimentsController.getPastExperimentsList
);
app.get(
  "/experiments/import/:id/status",
  experimentsController.getPastExperimentStatus
);
app.post(
  "/experiments/import/:id/cancel",
  experimentsController.cancelPastExperiments
);
app.post(
  "/experiments/notebook/:id",
  experimentsController.postSnapshotNotebook
);
app.post(
  "/experiments/report/:snapshot",
  reportsController.postReportFromSnapshot
);

// Reports
app.get("/report/:id", reportsController.getReport);
app.put("/report/:id", reportsController.putReport);
app.get("/report/:id/status", reportsController.getReportStatus);
app.post("/report/:id/refresh", reportsController.refreshReport);
app.post("/report/:id/cancel", reportsController.cancelReport);
app.post("/report/:id/notebook", reportsController.postNotebook);
app.get("/reports", reportsController.getReports);

// Segments
app.get("/segments", segmentsController.getAllSegments);
app.post("/segments", segmentsController.postSegments);
app.put("/segments/:id", segmentsController.putSegment);
app.delete("/segments/:id", segmentsController.deleteSegment);
app.get("/segments/:id/usage", segmentsController.getSegmentUsage);

// Dimensions
app.get("/dimensions", dimensionsController.getAllDimensions);
app.post("/dimensions", dimensionsController.postDimensions);
app.put("/dimensions/:id", dimensionsController.putDimension);
app.delete("/dimensions/:id", dimensionsController.deleteDimension);

// Projects
app.post("/projects", projectsController.postProjects);
app.put("/projects/:id", projectsController.putProject);
app.delete("/projects/:id", projectsController.deleteProject);

// Features
app.get("/feature", featuresController.getFeatures);
app.get("/feature/:id", featuresController.getFeatureById);
app.post("/feature", featuresController.postFeatures);
app.put("/feature/:id", featuresController.putFeature);
app.delete("/feature/:id", featuresController.deleteFeatureById);
app.get("/usage/features", featuresController.getRealtimeUsage);

// Data Sources
app.get("/datasources", organizationsController.getDataSources);
app.get("/datasource/:id", organizationsController.getDataSource);
app.post("/datasources", organizationsController.postDataSources);
app.put("/datasource/:id", organizationsController.putDataSource);
app.delete("/datasource/:id", organizationsController.deleteDataSource);

// API keys
app.get("/keys", organizationsController.getApiKeys);
app.post("/keys", organizationsController.postApiKey);
app.delete("/key/:key", organizationsController.deleteApiKey);

// Webhooks
app.get("/webhooks", organizationsController.getWebhooks);
app.post("/webhooks", organizationsController.postWebhook);
app.put("/webhook/:id", organizationsController.putWebhook);
app.delete("/webhook/:id", organizationsController.deleteWebhook);

// Presentations
app.get("/presentations", presentationController.getPresentations);
app.post("/presentation", presentationController.postPresentation);
app.get("/presentation/preview", presentationController.getPresentationPreview);
app.get("/presentation/:id", presentationController.getPresentation);
app.post("/presentation/:id", presentationController.updatePresentation);
app.delete("/presentation/:id", presentationController.deletePresentation);

// Discussions
app.get(
  "/discussion/:parentType/:parentId",
  discussionsController.getDiscussion
);
app.post(
  "/discussion/:parentType/:parentId",
  discussionsController.postDiscussions
);
app.put(
  "/discussion/:parentType/:parentId/:index",
  discussionsController.putComment
);
app.delete(
  "/discussion/:parentType/:parentId/:index",
  discussionsController.deleteComment
);
app.get("/discussions/recent/:num", discussionsController.getRecentDiscussions);
app.post("/file/upload/:filetype", discussionsController.postImageUploadUrl);

// Admin
app.get("/admin/organizations", adminController.getOrganizations);
app.post("/admin/organization/:id/populate", adminController.addSampleData);

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
