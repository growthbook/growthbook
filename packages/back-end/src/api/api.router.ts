import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { Router, Request } from "express";
import rateLimit from "express-rate-limit";
import bodyParser from "body-parser";
import * as Sentry from "@sentry/node";
import authenticateApiRequestMiddleware from "back-end/src/middleware/authenticateApiRequestMiddleware";
import { getBuild } from "back-end/src/util/build";
import { ApiRequestLocals } from "back-end/types/api";
import { IS_CLOUD, SENTRY_DSN } from "back-end/src/util/secrets";
import featuresRouter from "./features/features.router.js";
import experimentsRouter from "./experiments/experiments.router.js";
import snapshotsRouter from "./snapshots/snapshots.router.js";
import metricsRouter from "./metrics/metrics.router.js";
import usageRouter from "./usage/usage.router.js";
import segmentsRouter from "./segments/segments.router.js";
import projectsRouter from "./projects/projects.router.js";
import environmentsRouter from "./environments/environments.router.js";
import attributesRouter from "./attributes/attributes.router.js";
import savedGroupsRouter from "./saved-groups/saved-groups.router.js";
import sdkConnectionsRouter from "./sdk-connections/sdk-connections.router.js";
import sdkPayloadRouter from "./sdk-payload/sdk-payload.router.js";
import dataSourcesRouter from "./data-sources/data-sources.router.js";
import dimensionsRouter from "./dimensions/dimensions.router.js";
import visualChangesetsRouter from "./visual-changesets/visual-changesets.router.js";
import organizationsRouter from "./organizations/organizations.router.js";
import codeRefsRouter from "./code-refs/code-refs.router.js";
import factTablesRouter from "./fact-tables/fact-tables.router.js";
import factMetricsRouter from "./fact-metrics/fact-metrics.router.js";
import bulkImportRouter from "./bulk-import/bulk-import.router.js";
import membersRouter from "./members/members.router.js";
import { postCopyTransform } from "./openai/postCopyTransform.js";
import { getFeatureKeys } from "./features/getFeatureKeys.js";
import ingestionRouter from "./ingestion/ingestion.router.js";
import archetypesRouter from "./archetypes/archetypes.router.js";
import { getExperimentNames } from "./experiments/getExperimentNames.js";
import queryRouter from "./queries/queries.router.js";
import settingsRouter from "./settings/settings.router.js";
import { API_MODELS, defineRouterForApiConfig } from "./ApiModel.js";

const router = Router();
let openapiSpec: string;
router.get("/openapi.yaml", (req, res) => {
  if (!openapiSpec) {
    const file = path.join(__dirname, "..", "..", "generated", "spec.yaml");
    if (existsSync(file)) {
      openapiSpec = readFileSync(file).toString();
    }
  }
  if (!openapiSpec) {
    return res.status(500).json({
      message: "Unable to load OpenAPI spec",
    });
  }

  res.setHeader("Cache-Control", "max-age=3600");
  res.setHeader("Content-Type", "text/yaml");
  res.send(openapiSpec);
});

router.use(bodyParser.json({ limit: "2mb" }));
router.use(bodyParser.urlencoded({ limit: "2mb", extended: true }));

router.use(authenticateApiRequestMiddleware);

// Add API user to Sentry if configured
if (SENTRY_DSN) {
  router.use((req: Request & ApiRequestLocals, res, next) => {
    if (req.user) {
      Sentry.setUser({
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
      });
    }
    if (req.context.org) {
      Sentry.setTag("organization", req.context.org.id);
    }
    next();
  });
}

const API_RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX) || 60;
const overallRateLimit = IS_CLOUD ? 60 : API_RATE_LIMIT_MAX;
// Rate limit API keys to 60 requests per minute
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: API_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request & ApiRequestLocals) => req.apiKey,
    message: {
      message: `Too many requests, limit to ${overallRateLimit} per minute`,
    },
  }),
);

// Index health check route
router.get("/", (req, res) => {
  res.json({
    name: "GrowthBook API",
    apiVersion: 1,
    build: getBuild(),
  });
});

// API endpoints
router.use("/features", featuresRouter);
router.get("/feature-keys", getFeatureKeys);
router.use("/experiments", experimentsRouter);
router.get("/experiment-names", getExperimentNames);
router.use("/snapshots", snapshotsRouter);
router.use("/metrics", metricsRouter);
router.use("/usage", usageRouter);
router.use("/segments", segmentsRouter);
router.use("/dimensions", dimensionsRouter);
router.use("/projects", projectsRouter);
router.use("/environments", environmentsRouter);
router.use("/attributes", attributesRouter);
router.use("/sdk-connections", sdkConnectionsRouter);
router.use("/data-sources", dataSourcesRouter);
router.use("/visual-changesets", visualChangesetsRouter);
router.use("/saved-groups", savedGroupsRouter);
router.use("/organizations", organizationsRouter);
router.use("/sdk-payload", sdkPayloadRouter);
router.use("/fact-tables", factTablesRouter);
router.use("/fact-metrics", factMetricsRouter);
router.use("/bulk-import", bulkImportRouter);
router.use("/code-refs", codeRefsRouter);
router.use("/members", membersRouter);
router.use("/ingestion", ingestionRouter);
router.use("/archetypes", archetypesRouter);
router.use("/queries", queryRouter);
router.use("/settings", settingsRouter);
router.post("/transform-copy", postCopyTransform);
API_MODELS.forEach((modelClass) => {
  const apiConfig = modelClass.getModelConfig().apiConfig;
  if (!apiConfig) return;
  const r = defineRouterForApiConfig(apiConfig);
  if (r) {
    router.use(apiConfig.pathBase, r);
  }
});

// 404 route
router.use(function (req, res) {
  res.status(404).json({
    message: "Unknown API endpoint",
  });
});

export default router;
