import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import express, { ErrorRequestHandler, Request, Response } from "express";
import cors from "cors";
import asyncHandler from "express-async-handler";
import compression from "compression";
import * as Sentry from "@sentry/node";
import { usingFileConfig } from "./init/config";
import { AuthRequest } from "./types/AuthRequest";
import {
  APP_ORIGIN,
  CORS_ORIGIN_REGEX,
  ENVIRONMENT,
  IS_CLOUD,
  SENTRY_DSN,
  UPLOAD_METHOD,
} from "./util/secrets";
import {
  getExperimentConfig,
  getExperimentsScript,
} from "./controllers/config";
import { verifySlackRequestSignature } from "./services/slack";
import { getAuthConnection, processJWT, usingOpenId } from "./services/auth";
import { wrapController } from "./routers/wrapController";
import apiRouter from "./api/api.router";

if (SENTRY_DSN) {
  Sentry.init({ dsn: SENTRY_DSN });
}

// Begin Controllers
import * as authControllerRaw from "./controllers/auth";
const authController = wrapController(authControllerRaw);

import * as datasourcesControllerRaw from "./controllers/datasources";
const datasourcesController = wrapController(datasourcesControllerRaw);

import * as experimentsControllerRaw from "./controllers/experiments";
const experimentsController = wrapController(experimentsControllerRaw);

import * as metricsControllerRaw from "./controllers/metrics";
const metricsController = wrapController(metricsControllerRaw);

import * as reportsControllerRaw from "./controllers/reports";
const reportsController = wrapController(reportsControllerRaw);

import * as ideasControllerRaw from "./controllers/ideas";
const ideasController = wrapController(ideasControllerRaw);

import * as presentationControllerRaw from "./controllers/presentations";
const presentationController = wrapController(presentationControllerRaw);

import * as discussionsControllerRaw from "./controllers/discussions";
const discussionsController = wrapController(discussionsControllerRaw);

import * as adminControllerRaw from "./controllers/admin";
const adminController = wrapController(adminControllerRaw);

import * as stripeControllerRaw from "./controllers/stripe";
const stripeController = wrapController(stripeControllerRaw);

import * as vercelControllerRaw from "./controllers/vercel";
const vercelController = wrapController(vercelControllerRaw);

import * as featuresControllerRaw from "./controllers/features";
const featuresController = wrapController(featuresControllerRaw);

import * as slackControllerRaw from "./controllers/slack";
const slackController = wrapController(slackControllerRaw);

// End Controllers

import { isEmailEnabled } from "./services/email";
import { init } from "./init";
import { getBuild } from "./util/handler";
import { getCustomLogProps, httpLogger } from "./util/logger";
import { usersRouter } from "./routers/users/users.router";
import { organizationsRouter } from "./routers/organizations/organizations.router";
import { uploadsRouter } from "./routers/upload/upload.router";
import { eventsRouter } from "./routers/events/events.router";
import { eventWebHooksRouter } from "./routers/event-webhooks/event-webhooks.router";
import { tagRouter } from "./routers/tag/tag.router";
import { savedGroupRouter } from "./routers/saved-group/saved-group.router";
import { segmentRouter } from "./routers/segment/segment.router";
import { dimensionRouter } from "./routers/dimension/dimension.router";
import { sdkConnectionRouter } from "./routers/sdk-connection/sdk-connection.router";
import { projectRouter } from "./routers/project/project.router";
import verifyLicenseMiddleware from "./services/auth/verifyLicenseMiddleware";
import { slackIntegrationRouter } from "./routers/slack-integration/slack-integration.router";

const app = express();

if (SENTRY_DSN) {
  app.use(
    Sentry.Handlers.requestHandler({
      user: ["email", "sub"],
    })
  );
}

if (!process.env.NO_INIT) {
  init();
}

app.set("port", process.env.PORT || 3100);

// Pretty print on dev
if (ENVIRONMENT !== "production") {
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

app.get("/", (req, res) => {
  res.json({
    name: "GrowthBook API",
    production: ENVIRONMENT === "production",
    api_host: req.protocol + "://" + req.hostname + ":" + app.get("port"),
    app_origin: APP_ORIGIN,
    config_source: usingFileConfig() ? "file" : "db",
    email_enabled: isEmailEnabled(),
    build: getBuild(),
  });
});

app.use(httpLogger);

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
app.use(bodyParser.json({ limit: "1mb" }));

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
  "/api/features/:key?",
  cors({
    credentials: false,
    origin: "*",
  }),
  featuresController.getFeaturesPublic
);
// For preflight requests
app.options(
  "/api/features/:key?",
  cors({
    credentials: false,
    origin: "*",
  }),
  function (req, res) {
    res.send(200);
  }
);

// Secret API routes (no JWT or CORS)
app.use("/api/v1", apiRouter);

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

const useSSO = usingOpenId();

// Pre-auth requests when not using SSO
if (!useSSO) {
  app.post("/auth/login", authController.postLogin);
  app.post("/auth/register", authController.postRegister);
  app.post("/auth/firsttime", authController.postFirstTimeRegister);
  app.post("/auth/forgot", authController.postForgotPassword);
  app.get("/auth/reset/:token", authController.getResetPassword);
  app.post("/auth/reset/:token", authController.postResetPassword);
}
// Pre-auth requests when using SSO
else {
  app.post("/auth/sso", authController.getSSOConnectionFromDomain);
  app.post("/auth/callback", authController.postOAuthCallback);
}

//  Pre-auth requests that are always available
app.post("/auth/refresh", authController.postRefresh);
app.post("/auth/logout", authController.postLogout);
app.get("/auth/hasorgs", authController.getHasOrganizations);

// File uploads don't require auth tokens.
// Upload urls are signed and image access is public.
if (UPLOAD_METHOD === "local") {
  app.use("/upload", uploadsRouter);
}

// All other routes require a valid JWT
const auth = getAuthConnection();
app.use(auth.middleware);

// Add logged in user props to the request
app.use(processJWT);

// Add logged in user props to the logger
app.use(
  (req: AuthRequest, res: Response & { log: AuthRequest["log"] }, next) => {
    res.log = req.log = req.log.child(getCustomLogProps(req as Request));
    next();
  }
);

// Validate self hosted license key if present
app.use(verifyLicenseMiddleware);

// Logged-in auth requests
if (!useSSO) {
  app.post("/auth/change-password", authController.postChangePassword);
}

app.use("/user", usersRouter);

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
app.use(organizationsRouter);

app.post("/oauth/google", datasourcesController.postGoogleOauthRedirect);
app.post("/subscription/checkout", stripeController.postNewSubscription);
app.get("/subscription/quote", stripeController.getSubscriptionQuote);
app.post("/subscription/manage", stripeController.postCreateBillingSession);
app.post("/subscription/success", stripeController.postSubscriptionSuccess);
app.get("/queries/:ids", datasourcesController.getQueries);
app.post("/query/test", datasourcesController.testLimitedQuery);
app.post("/organization/sample-data", datasourcesController.postSampleData);

if (IS_CLOUD) {
  app.get("/vercel/has-token", vercelController.getHasToken);
  app.post("/vercel/token", vercelController.postToken);
  app.post("/vercel/env-vars", vercelController.postEnvVars);
  app.get("/vercel/config", vercelController.getConfig);
}

app.use("/tag", tagRouter);

app.use("/saved-groups", savedGroupRouter);

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
app.get("/metrics", metricsController.getMetrics);
app.post("/metrics", metricsController.postMetrics);
app.get("/metric/:id", metricsController.getMetric);
app.put("/metric/:id", metricsController.putMetric);
app.delete("/metric/:id", metricsController.deleteMetric);
app.get("/metric/:id/usage", metricsController.getMetricUsage);
app.post("/metric/:id/analysis", metricsController.postMetricAnalysis);
app.get(
  "/metric/:id/analysis/status",
  metricsController.getMetricAnalysisStatus
);
app.post("/metric/:id/analysis/cancel", metricsController.cancelMetricAnalysis);

// Experiments
app.get("/experiments", experimentsController.getExperiments);
app.post("/experiments", experimentsController.postExperiments);
app.get(
  "/experiments/frequency/month/:num",
  experimentsController.getExperimentsFrequencyMonth
);
app.get("/experiments/newfeatures/", experimentsController.getNewFeatures);
app.get("/experiments/snapshots/", experimentsController.getSnapshots);
app.get(
  "/experiments/tracking-key",
  experimentsController.lookupExperimentByTrackingKey
);
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
app.get("/experiment/:id/watchers", experimentsController.getWatchingUsers);
app.post("/experiment/:id/phase", experimentsController.postExperimentPhase);
app.post("/experiment/:id/status", experimentsController.postExperimentStatus);
app.put(
  "/experiment/:id/phase/:phase",
  experimentsController.putExperimentPhase
);
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
app.delete("/report/:id", reportsController.deleteReport);
app.get("/report/:id/status", reportsController.getReportStatus);
app.post("/report/:id/refresh", reportsController.refreshReport);
app.post("/report/:id/cancel", reportsController.cancelReport);
app.post("/report/:id/notebook", reportsController.postNotebook);
app.get("/reports", reportsController.getReports);

app.use("/segments", segmentRouter);

app.use("/dimensions", dimensionRouter);

app.use("/sdk-connections", sdkConnectionRouter);

app.use("/projects", projectRouter);

// Features
app.get("/feature", featuresController.getFeatures);
app.get("/feature/:id", featuresController.getFeatureById);
app.post("/feature", featuresController.postFeatures);
app.put("/feature/:id", featuresController.putFeature);
app.delete("/feature/:id", featuresController.deleteFeatureById);
app.post(
  "/feature/:id/defaultvalue",
  featuresController.postFeatureDefaultValue
);
app.post("/feature/:id/discard", featuresController.postFeatureDiscard);
app.post("/feature/:id/publish", featuresController.postFeaturePublish);
app.post("/feature/:id/archive", featuresController.postFeatureArchive);
app.post("/feature/:id/toggle", featuresController.postFeatureToggle);
app.post("/feature/:id/draft", featuresController.postFeatureDraft);
app.post("/feature/:id/rule", featuresController.postFeatureRule);
app.put("/feature/:id/rule", featuresController.putFeatureRule);
app.delete("/feature/:id/rule", featuresController.deleteFeatureRule);
app.post("/feature/:id/reorder", featuresController.postFeatureMoveRule);
app.get("/usage/features", featuresController.getRealtimeUsage);

// Data Sources
app.get("/datasources", datasourcesController.getDataSources);
app.get("/datasource/:id", datasourcesController.getDataSource);
app.post("/datasources", datasourcesController.postDataSources);
app.put("/datasource/:id", datasourcesController.putDataSource);
app.delete("/datasource/:id", datasourcesController.deleteDataSource);

// Events
app.use("/events", eventsRouter);
app.use(eventWebHooksRouter);

// Slack integration
app.use("/integrations/slack", slackIntegrationRouter);

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

if (SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

const errorHandler: ErrorRequestHandler = (
  err,
  req,
  res: Response & { sentry?: string },
  // eslint-disable-next-line
  next
) => {
  const status = err.status || 400;

  if (req.log) {
    req.log.error(err.message);
  } else {
    httpLogger.logger.error(getCustomLogProps(req), err.message);
  }

  res.status(status).json({
    status: status,
    message: err.message || "An error occurred",
    errorId: SENTRY_DSN ? res.sentry : undefined,
  });
};
app.use(errorHandler);

export default app;
