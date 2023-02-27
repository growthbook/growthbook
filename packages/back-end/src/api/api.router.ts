import { Router, Request } from "express";
import rateLimit from "express-rate-limit";
import bodyParser from "body-parser";
import authencateApiRequestMiddleware from "../middleware/authenticateApiRequestMiddleware";
import { getBuild } from "../util/handler";
import { ApiRequestLocals } from "../../types/api";
import featuresRouter from "./features/features.router";
import experimentsRouter from "./experiments/experiments.router";
import metricsRouter from "./metrics/metrics.router";
import segmentsRouter from "./segments/segments.router";
import projectsRouter from "./projects/projects.router";
import sdkConnectionsRouter from "./sdk-connections/sdk-connections.router";
import dataSourcesRouter from "./data-sources/data-sources.router";
import dimensionsRouter from "./dimensions/dimensions.router";
import openapiSpec from "./openapi/openapi.json";

const router = Router();

router.get("/swagger.json", (req, res) => {
  res.setHeader("Cache-Control", "max-age=3600");
  res.json(openapiSpec);
});

router.use(bodyParser.json({ limit: "1mb" }));
router.use(bodyParser.urlencoded({ limit: "1mb", extended: true }));

router.use(authencateApiRequestMiddleware);

// Rate limit API keys to 60 requests per minute
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request & ApiRequestLocals) => req.apiKey,
    message: { message: "Too many requests, limit to 60 per minute" },
  })
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
router.use("/experiments", experimentsRouter);
router.use("/metrics", metricsRouter);
router.use("/segments", segmentsRouter);
router.use("/dimensions", dimensionsRouter);
router.use("/projects", projectsRouter);
router.use("/sdk-connections", sdkConnectionsRouter);
router.use("/data-sources", dataSourcesRouter);

// 404 route
router.use(function (req, res) {
  res.status(404).json({
    message: "Unknown API endpoint",
  });
});

export default router;
