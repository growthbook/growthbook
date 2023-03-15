import { existsSync, readFileSync } from "fs";
import path from "path";
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
