import path from "path";
import { existsSync, readFileSync } from "fs";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import express, { ErrorRequestHandler, Request, Response } from "express";
import cors from "cors";
import asyncHandler from "express-async-handler";
import compression from "compression";
import * as Sentry from "@sentry/node";
import { populationDataRouter } from "back-end/src/routers/population-data/population-data.router";
import { usingFileConfig } from "./init/config";
import { AuthRequest } from "./types/AuthRequest";
import {
  APP_ORIGIN,
  CORS_ORIGIN_REGEX,
  ENVIRONMENT,
  EXPRESS_TRUST_PROXY_OPTS,
  IS_CLOUD,
  SENTRY_DSN,
} from "./util/secrets";
import {
  getExperimentConfig,
  getExperimentsScript,
} from "./controllers/config";
import { verifySlackRequestSignature } from "./services/slack";
import { getAuthConnection, processJWT, usingOpenId } from "./services/auth";
import { wrapController } from "./routers/wrapController";
import apiRouter from "./api/api.router";
import scimRouter from "./scim/scim.router";
import { getBuild } from "./util/handler";

if (SENTRY_DSN) {
  const buildInfo = getBuild();

  Sentry.init({ dsn: SENTRY_DSN, release: buildInfo.sha });

  Sentry.setTag("build_date", buildInfo.date);
}

// Begin Controllers
import * as authControllerRaw from "./controllers/auth";
const authController = wrapController(authControllerRaw);

import * as datasourcesControllerRaw from "./controllers/datasources";
const datasourcesController = wrapController(datasourcesControllerRaw);

import * as experimentsControllerRaw from "./controllers/experiments";
const experimentsController = wrapController(experimentsControllerRaw);

import * as experimentLaunchChecklistControllerRaw from "./controllers/experimentLaunchChecklist";
const experimentLaunchChecklistController = wrapController(
  experimentLaunchChecklistControllerRaw
);

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

import * as licenseControllerRaw from "./controllers/license";
const licenseController = wrapController(licenseControllerRaw);

import * as stripeControllerRaw from "./controllers/stripe";
const stripeController = wrapController(stripeControllerRaw);

import * as vercelControllerRaw from "./controllers/vercel";
const vercelController = wrapController(vercelControllerRaw);

import * as featuresControllerRaw from "./controllers/features";
const featuresController = wrapController(featuresControllerRaw);

import * as slackControllerRaw from "./controllers/slack";
const slackController = wrapController(slackControllerRaw);

import * as informationSchemasControllerRaw from "./controllers/informationSchemas";
const informationSchemasController = wrapController(
  informationSchemasControllerRaw
);

// End Controllers

import { isEmailEnabled } from "./services/email";
import { init } from "./init";
import { getCustomLogProps, httpLogger } from "./util/logger";
import { usersRouter } from "./routers/users/users.router";
import { organizationsRouter } from "./routers/organizations/organizations.router";
import { uploadRouter } from "./routers/upload/upload.router";
import { eventsRouter } from "./routers/events/events.router";
import { eventWebHooksRouter } from "./routers/event-webhooks/event-webhooks.router";
import { tagRouter } from "./routers/tag/tag.router";
import { savedGroupRouter } from "./routers/saved-group/saved-group.router";
import { ArchetypeRouter } from "./routers/archetype/archetype.router";
import { AttributeRouter } from "./routers/attributes/attributes.router";
import { customFieldsRouter } from "./routers/custom-fields/custom-fields.router";
import { segmentRouter } from "./routers/segment/segment.router";
import { dimensionRouter } from "./routers/dimension/dimension.router";
import { sdkConnectionRouter } from "./routers/sdk-connection/sdk-connection.router";
import { projectRouter } from "./routers/project/project.router";
import { factTableRouter } from "./routers/fact-table/fact-table.router";
import { slackIntegrationRouter } from "./routers/slack-integration/slack-integration.router";
import { dataExportRouter } from "./routers/data-export/data-export.router";
import { demoDatasourceProjectRouter } from "./routers/demo-datasource-project/demo-datasource-project.router";
import { environmentRouter } from "./routers/environment/environment.router";
import { teamRouter } from "./routers/teams/teams.router";
import { githubIntegrationRouter } from "./routers/github-integration/github-integration.router";
import { urlRedirectRouter } from "./routers/url-redirects/url-redirects.router";
import { metricAnalysisRouter } from "./routers/metric-analysis/metric-analysis.router";
import { metricGroupRouter } from "./routers/metric-group/metric-group.router";
import { findOrCreateGeneratedHypothesis } from "./models/GeneratedHypothesis";
import { getContextFromReq } from "./services/organizations";
import { templateRouter } from "./routers/experiment-template/template.router";

const app = express();

if (SENTRY_DSN) {
  app.use(
    Sentry.Handlers.requestHandler({
      user: ["email", "sub"],
    })
  );
}

if (!process.env.NO_INIT && process.env.NODE_ENV !== "test") {
  init();
}

app.set("port", process.env.PORT || 3100);
app.set("trust proxy", EXPRESS_TRUST_PROXY_OPTS);

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

let robotsTxt = "";
app.get("/robots.txt", (_req, res) => {
  if (!robotsTxt) {
    const file =
      process.env.ROBOTS_TXT_PATH || path.join(__dirname, "..", "robots.txt");
    if (existsSync(file)) {
      robotsTxt = readFileSync(file).toString();
    } else {
      res.status(404).json({
        message: "Not found",
      });
      return;
    }
  }

  res.setHeader("Cache-Control", "max-age=3600");
  res.setHeader("Content-Type", "text/plain");
  res.send(robotsTxt);
});

app.use(compression());

app.get("/", (req, res) => {
  res.json({
    name: "GrowthBook API",
    production: ENVIRONMENT === "production",
    api_host:
      process.env.API_HOST ||
      req.protocol + "://" + req.hostname + ":" + app.get("port"),
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

// Public features for SDKs
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
  (req, res) => res.send(200)
);

if (!IS_CLOUD) {
  // Public remoteEval for SDKs:
  // note: Self-hosted only, recommended for debugging. Cloud orgs must use separate infrastructure.
  app.post(
    "/api/eval/:key?",
    cors({
      credentials: false,
      origin: "*",
    }),
    featuresController.getEvaluatedFeaturesPublic
  );
  // For preflight requests
  app.options(
    "/api/eval/:key?",
    cors({
      credentials: false,
      origin: "*",
    }),
    (req, res) => res.send(200)
  );
}

// public shareable reports
app.get(
  "/api/report/public/:uid",
  cors({
    credentials: false,
    origin: "*",
  }),
  reportsController.getReportPublic
);
// public shareable experiments
app.get(
  "/api/experiment/public/:uid",
  cors({
    credentials: false,
    origin: "*",
  }),
  experimentsController.getExperimentPublic
);

// Secret API routes (no JWT or CORS)
app.use(
  "/api/v1",
  // TODO add authentication
  cors({
    origin: "*",
  }),
  apiRouter
);

// SCIM API routes (no JWT or CORS)
app.use(
  "/scim/v2",
  bodyParser.json({
    type: "application/scim+json",
  }),
  cors({
    origin: "*",
  }),
  scimRouter
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

// All other routes require a valid JWT
const auth = getAuthConnection();
app.use(auth.middleware);

// Add logged in user props to the request
app.use(asyncHandler(processJWT));

// Add logged in user props to the logger
app.use(
  (req: AuthRequest, res: Response & { log: AuthRequest["log"] }, next) => {
    res.log = req.log = req.log.child(getCustomLogProps(req as Request));
    next();
  }
);

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

app.use("/environment", environmentRouter);

app.post("/oauth/google", datasourcesController.postGoogleOauthRedirect);
app.post(
  "/subscription/new-pro-trial",
  stripeController.postNewProTrialSubscription
);

if (IS_CLOUD) {
  app.post(
    "/subscription/payment-methods/setup-intent",
    stripeController.postSetupIntent
  );
  app.get(
    "/subscription/payment-methods",
    stripeController.fetchPaymentMethods
  );
  app.post(
    "/subscription/payment-methods/detach",
    stripeController.deletePaymentMethod
  );
  app.post(
    "/subscription/payment-methods/set-default",
    stripeController.updateCustomerDefaultPayment
  );
}
app.post("/subscription/new", stripeController.postNewProSubscription);
app.post("/subscription/manage", stripeController.postCreateBillingSession);
app.post("/subscription/success", stripeController.postSubscriptionSuccess);

app.get("/billing/usage", stripeController.getUsage);

app.get("/queries/:ids", datasourcesController.getQueries);
app.post("/query/test", datasourcesController.testLimitedQuery);
app.post("/dimension-slices", datasourcesController.postDimensionSlices);
app.get("/dimension-slices/:id", datasourcesController.getDimensionSlices);
app.post(
  "/dimension-slices/:id/cancel",
  datasourcesController.cancelDimensionSlices
);

app.get(
  "/dimension-slices/datasource/:datasourceId/:exposureQueryId",
  datasourcesController.getLatestDimensionSlicesForDatasource
);

if (IS_CLOUD) {
  app.get("/vercel/has-token", vercelController.getHasToken);
  app.post("/vercel/token", vercelController.postToken);
  app.post("/vercel/env-vars", vercelController.postEnvVars);
  app.get("/vercel/config", vercelController.getConfig);
}

app.use("/tag", tagRouter);

app.use("/saved-groups", savedGroupRouter);

app.use("/archetype", ArchetypeRouter);

app.use("/attribute", AttributeRouter);

app.use("/custom-fields", customFieldsRouter);

// Ideas
app.get("/ideas", ideasController.getIdeas);
app.post("/ideas", ideasController.postIdeas);
app.get("/idea/:id", ideasController.getIdea);
app.post("/idea/:id", ideasController.postIdea);
app.delete("/idea/:id", ideasController.deleteIdea);
app.post("/idea/:id/vote", ideasController.postVote);
app.post("/ideas/impact", ideasController.getEstimatedImpact);
app.get("/ideas/recent/:num", ideasController.getRecentIdeas);

// Metrics
app.get("/metrics", metricsController.getMetrics);
app.post("/metrics", metricsController.postMetrics);
app.post(
  "/metrics/tracked-events/:datasourceId",
  metricsController.getMetricsFromTrackedEvents
);
app.post("/metrics/auto-metrics", metricsController.postAutoGeneratedMetrics);
app.get("/metric/:id", metricsController.getMetric);
app.put("/metric/:id", metricsController.putMetric);
app.delete("/metric/:id", metricsController.deleteMetric);
app.get("/metric/:id/usage", metricsController.getMetricUsage);
app.post("/metric/:id/analysis", metricsController.postLegacyMetricAnalysis);
app.post(
  "/metric/:id/analysis/cancel",
  metricsController.cancelLegacyMetricAnalysis
);
app.get(
  "/metrics/:id/experiments",
  metricsController.getMetricExperimentResults
);
app.get("/metrics/:id/northstar", metricsController.getMetricNorthstarData);

// Metric Analyses
app.use(metricAnalysisRouter);

// Metric Groups
app.use(metricGroupRouter);

// Population Data for power
app.use(populationDataRouter);

// Experiments
app.get("/experiments", experimentsController.getExperiments);
app.post("/experiments", experimentsController.postExperiments);
app.get(
  "/experiments/frequency/month/:num",
  experimentsController.getExperimentsFrequencyMonth
);
app.get(
  "/experiments/tracking-key",
  experimentsController.lookupExperimentByTrackingKey
);
app.get("/experiment/:id", experimentsController.getExperiment);
app.get("/experiment/:id/reports", reportsController.getReportsOnExperiment);
app.get("/snapshot/:id", experimentsController.getSnapshotById);
app.post("/snapshot/:id/cancel", experimentsController.cancelSnapshot);
app.post("/snapshot/:id/analysis", experimentsController.postSnapshotAnalysis);
app.get("/experiment/:id/snapshot/:phase", experimentsController.getSnapshot);
app.get(
  "/experiment/:id/snapshot/:phase/:dimension",
  experimentsController.getSnapshotWithDimension
);
app.post("/experiment/:id/snapshot", experimentsController.postSnapshot);
app.post(
  "/experiment/:id/banditSnapshot",
  experimentsController.postBanditSnapshot
);

app.get("/experiments/snapshots", experimentsController.getSnapshots);
app.post(
  "/experiments/snapshots/scaled",
  experimentsController.postSnapshotsWithScaledImpactAnalysis
);
app.post("/experiment/:id", experimentsController.postExperiment);
app.delete("/experiment/:id", experimentsController.deleteExperiment);
app.get("/experiment/:id/watchers", experimentsController.getWatchingUsers);
app.post("/experiment/:id/phase", experimentsController.postExperimentPhase);
app.post(
  "/experiment/:id/targeting",
  experimentsController.postExperimentTargeting
);
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
app.post(
  "/experiments/launch-checklist",
  experimentLaunchChecklistController.postExperimentLaunchChecklist
);
app.put(
  "/experiments/launch-checklist/:id",
  experimentLaunchChecklistController.putExperimentLaunchChecklist
);
app.get(
  "/experiments/launch-checklist",
  experimentLaunchChecklistController.getExperimentCheckListByOrg
);
app.put(
  "/experiment/:id/launch-checklist",
  experimentLaunchChecklistController.putManualLaunchChecklist
);

// Visual Changesets
app.post(
  "/experiments/:id/visual-changeset",
  experimentsController.postVisualChangeset
);
app.put("/visual-changesets/:id", experimentsController.putVisualChangeset);
app.delete(
  "/visual-changesets/:id",
  experimentsController.deleteVisualChangeset
);

// Refresh Time Series
app.post(
  "/experiments/:id/refresh-time-series",
  experimentsController.refreshTimeSeries
);

app.get("/experiments/:id/time-series", experimentsController.getTimeSeries);

// Visual editor auth
app.get(
  "/visual-editor/key",
  experimentsController.findOrCreateVisualEditorToken
);

// Experiment Templates
app.use("/templates", templateRouter);

// URL Redirects
app.use("/url-redirects", urlRedirectRouter);

// Reports
app.get("/report/:id", reportsController.getReport);
app.put("/report/:id", reportsController.putReport);
app.delete("/report/:id", reportsController.deleteReport);
app.post("/report/:id/refresh", reportsController.refreshReport);
app.post("/report/:id/cancel", reportsController.cancelReport);
app.post("/report/:id/notebook", reportsController.postNotebook);
app.get("/reports", reportsController.getReports);

app.use("/segments", segmentRouter);

app.use("/dimensions", dimensionRouter);

app.use("/sdk-connections", sdkConnectionRouter);

app.use("/projects", projectRouter);

app.use(factTableRouter);

app.use("/demo-datasource-project", demoDatasourceProjectRouter);

// Features
app.get("/feature", featuresController.getFeatures);
app.get("/feature/:id", featuresController.getFeatureById);
app.get("/feature/:id/usage", featuresController.getFeatureUsage);
app.post("/feature", featuresController.postFeatures);
app.put("/feature/:id", featuresController.putFeature);
app.delete("/feature/:id", featuresController.deleteFeatureById);
app.post(
  "/feature/:id/:version/defaultvalue",
  featuresController.postFeatureDefaultValue
);
app.post("/feature/:id/sync", featuresController.postFeatureSync);
app.post("/feature/:id/schema", featuresController.postFeatureSchema);
app.post(
  "/feature/:id/:version/discard",
  featuresController.postFeatureDiscard
);
app.post(
  "/feature/:id/:version/publish",
  featuresController.postFeaturePublish
);
app.post(
  "/feature/:id/:version/request",
  featuresController.postFeatureRequestReview
);
app.post(
  "/feature/:id/:version/submit-review",
  featuresController.postFeatureReviewOrComment
);
app.get("/feature/:id/:version/log", featuresController.getRevisionLog);
app.post("/feature/:id/archive", featuresController.postFeatureArchive);
app.post("/feature/:id/toggle", featuresController.postFeatureToggle);
app.post("/feature/:id/:version/fork", featuresController.postFeatureFork);
app.post("/feature/:id/:version/rebase", featuresController.postFeatureRebase);
app.post("/feature/:id/:version/revert", featuresController.postFeatureRevert);
app.post("/feature/:id/:version/rule", featuresController.postFeatureRule);
app.post(
  "/feature/:id/:version/experiment",
  featuresController.postFeatureExperimentRefRule
);
app.put("/feature/:id/:version/comment", featuresController.putRevisionComment);
app.put("/feature/:id/:version/rule", featuresController.putFeatureRule);
app.delete("/feature/:id/:version/rule", featuresController.deleteFeatureRule);
app.post("/feature/:id/prerequisite", featuresController.postPrerequisite);
app.put("/feature/:id/prerequisite", featuresController.putPrerequisite);
app.delete("/feature/:id/prerequisite", featuresController.deletePrerequisite);
app.post(
  "/feature/:id/:version/reorder",
  featuresController.postFeatureMoveRule
);
app.post("/features/eval", featuresController.postFeaturesEvaluate);
app.post("/feature/:id/:version/eval", featuresController.postFeatureEvaluate);
app.get("/usage/features", featuresController.getRealtimeUsage);
app.post(
  "/feature/:id/toggleStaleDetection",
  featuresController.toggleStaleFFDetectionForFeature
);
app.post(
  "/feature/:id/:version/comment",
  featuresController.postFeatureReviewOrComment
);
app.post(
  "/feature/:id/:version/copyEnvironment",
  featuresController.postCopyEnvironmentRules
);

app.get("/revision/feature", featuresController.getDraftandReviewRevisions);

// Data Sources
app.get("/datasources", datasourcesController.getDataSources);
app.get("/datasource/:id", datasourcesController.getDataSource);
app.post("/datasources", datasourcesController.postDataSources);
app.put("/datasource/:id", datasourcesController.putDataSource);
app.delete("/datasource/:id", datasourcesController.deleteDataSource);
app.get("/datasource/:id/metrics", datasourcesController.getDataSourceMetrics);
app.get("/datasource/:id/queries", datasourcesController.getDataSourceQueries);
app.put(
  "/datasource/:datasourceId/exposureQuery/:exposureQueryId",
  datasourcesController.updateExposureQuery
);
app.post(
  "/datasources/fetch-bigquery-datasets",
  datasourcesController.fetchBigQueryDatasets
);

if (IS_CLOUD) {
  app.post(
    "/datasource/create-inbuilt",
    datasourcesController.postInbuiltDataSource
  );
}

// Information Schemas
app.get(
  "/datasource/:datasourceId/schema/table/:tableId",
  informationSchemasController.getTableData
);
app.put(
  "/datasource/:datasourceId/schema/table/:tableId",
  informationSchemasController.putTableData
);
app.post(
  "/datasource/:datasourceId/schema",
  informationSchemasController.postInformationSchema
);
app.put(
  "/datasource/:datasourceId/schema",
  informationSchemasController.putInformationSchema
);
app.get(
  "/datasource/:datasourceId/schema",
  informationSchemasController.getInformationSchema
);

// Events
app.use("/events", eventsRouter);
app.use(eventWebHooksRouter);

// Slack integration
app.use("/integrations/slack", slackIntegrationRouter);
app.use("/integrations/github", githubIntegrationRouter);

// Data Export
app.use("/data-export", dataExportRouter);

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
app.use("/upload", uploadRouter);

// Teams
app.use("/teams", teamRouter);

// Admin
app.get("/admin/organizations", adminController.getOrganizations);
app.put("/admin/organization", adminController.putOrganization);
app.put("/admin/organization/disable", adminController.disableOrganization);
app.put("/admin/organization/enable", adminController.enableOrganization);
app.get(
  "/admin/organization/:orgId/members",
  adminController.getOrganizationMembers
);
app.get("/admin/members", adminController.getMembers);
app.put("/admin/member", adminController.putMember);

// License
app.get("/license", licenseController.getLicenseData);
app.get("/license/report", licenseController.getLicenseReport);
app.post(
  "/license/enterprise-trial",
  licenseController.postCreateTrialEnterpriseLicense
);
app.post(
  "/license/resend-verification-email",
  licenseController.postResendEmailVerificationEmail
);
app.post("/license/verify-email", licenseController.postVerifyEmail);

app.get(
  "/generated-hypothesis/:uuid",
  async (req: AuthRequest<null, { uuid: string }>, res) => {
    const context = getContextFromReq(req);
    const generatedHypothesis = await findOrCreateGeneratedHypothesis(
      context,
      req.params.uuid
    );
    return res.json({ generatedHypothesis });
  }
);

// Meta info
app.get("/meta/ai", (req, res) => {
  res.json({
    enabled: !!process.env.OPENAI_API_KEY,
  });
});

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
