import { existsSync, readFileSync } from "fs";
import path from "path";
import { Router, Request, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import bodyParser from "body-parser";
import * as Sentry from "@sentry/node";
import { parseEnvInt } from "shared/util";
import authenticateApiRequestMiddleware from "back-end/src/middleware/authenticateApiRequestMiddleware";
import { DashboardModel } from "back-end/src/enterprise/models/DashboardModel";
import { ContextualBanditModel } from "back-end/src/enterprise/models/ContextualBanditModel";
import { ContextualBanditQueryModel } from "back-end/src/enterprise/models/ContextualBanditQueryModel";
import { CustomFieldModel } from "back-end/src/models/CustomFieldModel";
import { MetricGroupModel } from "back-end/src/models/MetricGroupModel";
import { TeamModel } from "back-end/src/models/TeamModel";
import { ExperimentTemplatesModel } from "back-end/src/models/ExperimentTemplateModel";
import { AnalyticsExplorationModel } from "back-end/src/models/AnalyticsExplorationModel";
import { RampScheduleTemplateModel } from "back-end/src/models/RampScheduleTemplateModel";
import { RampScheduleModel } from "back-end/src/models/RampScheduleModel";
import { InsightModel } from "back-end/src/models/InsightModel";
import { ModelClass } from "back-end/src/services/context";
import { getBuild } from "back-end/src/util/build";
import { ApiRequestLocals } from "back-end/types/api";
import { IS_CLOUD, SENTRY_DSN } from "back-end/src/util/secrets";
import { featureRoutes } from "./features/features.router";
import { featureV2Routes } from "./features/features.v2.router";
import { experimentsRoutes } from "./experiments/experiments.router";
import { contextualBanditsRoutes } from "./contextual-bandits/contextual-bandits.router";
import { snapshotsRoutes } from "./snapshots/snapshots.router";
import { metricsRoutes } from "./metrics/metrics.router";
import { usageRoutes } from "./usage/usage.router";
import { segmentsRoutes } from "./segments/segments.router";
import { projectsRoutes } from "./projects/projects.router";
import { environmentsRoutes } from "./environments/environments.router";
import { attributesRoutes } from "./attributes/attributes.router";
import { savedGroupsRoutes } from "./saved-groups/saved-groups.router";
import { constantsRoutes } from "./constants/constants.router";
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
import { visualEditorAiRoutes } from "./visual-editor-ai/visualEditorAi.router";
import { archetypesRoutes } from "./archetypes/archetypes.router";
import { queriesRoutes } from "./queries/queries.router";
import { settingsRoutes } from "./settings/settings.router";
import { metaRoutes } from "./meta/meta.router";
import { informationSchemaTablesRoutes } from "./information-schema-tables/information-schema-tables.router";
import { rampSchedulesRoutes } from "./ramp-schedules/ramp-schedules.router";
import { reportRoutes } from "./reports/reports.router";
import { namespacesRoutes } from "./namespaces/namespaces.router";
import { getOpenApiRoutesForApiConfig } from "./ApiModel";

const API_MODELS: ModelClass[] = [
  DashboardModel,
  ContextualBanditModel,
  ContextualBanditQueryModel,
  CustomFieldModel,
  MetricGroupModel,
  TeamModel,
  ExperimentTemplatesModel,
  AnalyticsExplorationModel,
  RampScheduleTemplateModel,
  RampScheduleModel,
  InsightModel,
];

const router = Router();

router.use(bodyParser.json({ limit: "2mb" }));
router.use(bodyParser.urlencoded({ limit: "2mb", extended: true }));

// Public route for OpenAPI spec - must be registered BEFORE authentication middleware
let openapiSpec: string;
router.get("/v1/openapi.yaml", (req, res) => {
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
// Rate limit API keys to 60 requests per minute. Skip for JWT requests
// (interactive UI traffic) — those are already authed as a logged-in user
// and applying the per-key cap would break dashboards and bulk flows.
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: API_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => !!(req as Request & ApiRequestLocals).isJwtAuth,
    keyGenerator: (req) => (req as Request & ApiRequestLocals).apiKey,
    message: {
      message: `Too many requests, limit to ${overallRateLimit} per minute`,
    },
  }),
);

// Index health check route. Registered at both `/` (mounted at `/api/`) and
// `/v1/` (mounted at `/api/v1/`). Before #5690 the router was mounted at
// `/api/v1` directly, so `router.get("/")` answered `/api/v1/`. #5690 moved
// the mount to `/api` with the registration loop below self-prefixing `/v1/`
// onto other routes, and #5804 hand-updated the openapi route similarly —
// but this index handler was missed, leaving `/api/v1/` unrouted.
const indexHandler: RequestHandler = (req, res) => {
  res.json({
    name: "GrowthBook API",
    apiVersion: 1,
    build: getBuild(),
  });
};
router.get("/", indexHandler);
router.get("/v1/", indexHandler);

export const allRoutes = [
  ...featureRoutes,
  ...featureV2Routes,
  ...archetypesRoutes,
  ...experimentsRoutes,
  ...contextualBanditsRoutes,
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
  ...constantsRoutes,
  ...organizationsRoutes,
  ...sdkPayloadRoutes,
  ...factTablesRoutes,
  ...factMetricsRoutes,
  ...bulkImportRoutes,
  ...codeRefsRoutes,
  ...membersRoutes,
  ...queriesRoutes,
  ...settingsRoutes,
  ...metaRoutes,
  ...informationSchemaTablesRoutes,
  ...rampSchedulesRoutes,
  ...reportRoutes,
  ...namespacesRoutes,
  ...openaiRoutes,
  ...visualEditorAiRoutes,
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

  // Prepend version prefix so v1 routes live at /v1/... and v2 at /v2/...
  // The router is mounted at /api in app.ts, so the full path becomes
  // /api/v1/<route> or /api/v2/<route> as appropriate.
  const version = (route as { version?: string }).version ?? "v1";
  const versionedPath = `/${version}${route.path}`;

  const middleware: RequestHandler[] = [
    ...(route.middleware ?? []),
    // Emit RFC 8594 Deprecation header when the route spec provides a date.
    ...(route.deprecationDate
      ? [
          ((_, res, next) => {
            res.setHeader("Deprecation", route.deprecationDate as string);
            next();
          }) as RequestHandler,
        ]
      : []),
  ];

  if (middleware.length > 0) {
    router[route.method](versionedPath, middleware, route.handler);
  } else {
    router[route.method](versionedPath, route.handler);
  }
});

// 404 route
router.use(function (req, res) {
  res.status(404).json({
    message: "Unknown API endpoint",
  });
});

export default router;
