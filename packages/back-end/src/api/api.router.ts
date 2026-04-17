import { existsSync, readFileSync } from "fs";
import path from "path";
import { Router, Request, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import bodyParser from "body-parser";
import * as Sentry from "@sentry/node";
import { parseEnvInt } from "shared/util";
import authenticateApiRequestMiddleware from "back-end/src/middleware/authenticateApiRequestMiddleware";
import { DashboardModel } from "back-end/src/enterprise/models/DashboardModel";
import { CustomFieldModel } from "back-end/src/models/CustomFieldModel";
import { MetricGroupModel } from "back-end/src/models/MetricGroupModel";
import { TeamModel } from "back-end/src/models/TeamModel";
import { ExperimentTemplatesModel } from "back-end/src/models/ExperimentTemplateModel";
import { AnalyticsExplorationModel } from "back-end/src/models/AnalyticsExplorationModel";
import { RampScheduleTemplateModel } from "back-end/src/models/RampScheduleTemplateModel";
import { RampScheduleModel } from "back-end/src/models/RampScheduleModel";
import { ModelClass } from "back-end/src/services/context";
import { getBuild } from "back-end/src/util/build";
import { ApiRequestLocals } from "back-end/types/api";
import { IS_CLOUD, SENTRY_DSN } from "back-end/src/util/secrets";
import { featureRoutes } from "./features/features.router";
import { experimentsRoutes } from "./experiments/experiments.router";
import { snapshotsRoutes } from "./snapshots/snapshots.router";
import { metricsRoutes } from "./metrics/metrics.router";
import { usageRoutes } from "./usage/usage.router";
import { segmentsRoutes } from "./segments/segments.router";
import { projectsRoutes } from "./projects/projects.router";
import { environmentsRoutes } from "./environments/environments.router";
import { attributesRoutes } from "./attributes/attributes.router";
import { savedGroupsRoutes } from "./saved-groups/saved-groups.router";
import { sdkConnectionsRoutes } from "./sdk-connections/sdk-connections.router";
import { sdkPayloadRoutes } from "./sdk-payload/sdk-payload.router";
import { dataSourcesRoutes } from "./data-sources/data-sources.router";
import { dimensionsRoutes } from "./dimensions/dimensions.router";
import { visualChangesetsRoutes } from "./visual-changesets/visual-changesets.router";
import { organizationsRoutes } from "./organizations/organizations.router";
import { codeRefsRoutes } from "./code-refs/code-refs.router";
import { factTablesRoutes } from "./fact-tables/fact-tables.router";
import { factMetricsRoutes } from "./fact-metrics/fact-metrics.router";
import { bulkImportRoutes } from "./bulk-import/bulk-import.router";
import { membersRoutes } from "./members/members.router";
import { openaiRoutes } from "./openai/openai.router";
import { ingestionRoutes } from "./ingestion/ingestion.router";
import { archetypesRoutes } from "./archetypes/archetypes.router";
import { queriesRoutes } from "./queries/queries.router";
import { settingsRoutes } from "./settings/settings.router";
import { informationSchemaTablesRoutes } from "./information-schema-tables/information-schema-tables.router";
import { rampSchedulesRoutes } from "./ramp-schedules/ramp-schedules.router";
import { getOpenApiRoutesForApiConfig } from "./ApiModel";

const API_MODELS: ModelClass[] = [
  DashboardModel,
  CustomFieldModel,
  MetricGroupModel,
  TeamModel,
  ExperimentTemplatesModel,
  AnalyticsExplorationModel,
  RampScheduleTemplateModel,
  RampScheduleModel,
];

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

router.use(authenticateApiRequestMiddleware as RequestHandler);

// Add API user to Sentry if configured
if (SENTRY_DSN) {
  router.use(((req: Request & ApiRequestLocals, res, next) => {
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
  }) as RequestHandler);
}

const API_RATE_LIMIT_MAX = parseEnvInt(process.env.API_RATE_LIMIT_MAX, 60, {
  min: 1,
  name: "API_RATE_LIMIT_MAX",
});
const overallRateLimit = IS_CLOUD ? 60 : API_RATE_LIMIT_MAX;
// Rate limit API keys to 60 requests per minute
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: API_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as Request & ApiRequestLocals).apiKey,
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

export const allRoutes = [
  ...featureRoutes,
  ...archetypesRoutes,
  ...experimentsRoutes,
  ...snapshotsRoutes,
  ...metricsRoutes,
  ...usageRoutes,
  ...segmentsRoutes,
  ...dimensionsRoutes,
  ...projectsRoutes,
  ...environmentsRoutes,
  ...attributesRoutes,
  ...sdkConnectionsRoutes,
  ...dataSourcesRoutes,
  ...visualChangesetsRoutes,
  ...savedGroupsRoutes,
  ...organizationsRoutes,
  ...sdkPayloadRoutes,
  ...factTablesRoutes,
  ...factMetricsRoutes,
  ...bulkImportRoutes,
  ...codeRefsRoutes,
  ...membersRoutes,
  ...ingestionRoutes,
  ...queriesRoutes,
  ...settingsRoutes,
  ...informationSchemaTablesRoutes,
  ...rampSchedulesRoutes,
  ...openaiRoutes,
];

/** Tag metadata from BaseModel specs, keyed by PascalCase tag name */
export const apiModelTagMeta: Record<
  string,
  { displayName?: string; description?: string }
> = {};
API_MODELS.forEach((modelClass) => {
  const apiConfig = modelClass.getModelConfig().apiConfig;
  if (!apiConfig) return;
  const routes = getOpenApiRoutesForApiConfig(apiConfig);
  allRoutes.push(...routes);

  const spec = apiConfig.openApiSpec;
  const tag =
    spec.tag ??
    spec.modelPlural.charAt(0).toUpperCase() + spec.modelPlural.slice(1);
  apiModelTagMeta[tag] = {
    displayName: spec.navDisplayName,
    description: spec.navDescription ?? "",
  };
});

allRoutes.forEach((route) => {
  if (!route.method) {
    return;
  }

  if (route.middleware) {
    router[route.method](route.path, route.middleware, route.handler);
  } else {
    router[route.method](route.path, route.handler);
  }
});

// 404 route
router.use(function (req, res) {
  res.status(404).json({
    message: "Unknown API endpoint",
  });
});

export default router;
